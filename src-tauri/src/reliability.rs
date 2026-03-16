use chrono::Utc;
use reqwest::blocking::Client;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineSessionPayload {
    pub session_id: String,
    pub booth_id: String,
    pub final_image_data_url: Option<String>,
    pub photo_data_urls: Vec<String>,
    pub gif_data_url: Option<String>,
    pub contact_email: Option<String>,
    pub contact_phone: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncQueueStats {
    pub pending: i64,
    pub syncing: i64,
    pub failed: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncEnvelope {
    pub job_id: String,
    pub payload: OfflineSessionPayload,
}

#[derive(Debug, Clone)]
struct SyncConfig {
    api_base_url: String,
    sync_secret: Option<String>,
}

pub struct ReliabilityState {
    db_path: PathBuf,
    config: Arc<Mutex<SyncConfig>>,
}

impl ReliabilityState {
    fn open_conn(&self) -> Result<Connection, String> {
        Connection::open(&self.db_path).map_err(|e| format!("Open queue DB failed: {e}"))
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn next_retry_seconds(retries: i64) -> i64 {
    match retries {
        0..=2 => 10,
        3..=5 => 30,
        _ => 120,
    }
}

fn init_db(db_path: &PathBuf) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Init DB open failed: {e}"))?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS offline_sync_jobs (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            retries INTEGER NOT NULL DEFAULT 0,
            next_retry_at TEXT,
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_offline_sync_jobs_status_retry
            ON offline_sync_jobs (status, next_retry_at, created_at);
        ",
    )
    .map_err(|e| format!("Init DB schema failed: {e}"))?;

    Ok(())
}

fn get_due_jobs(conn: &Connection, limit: i64) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare(
            "
            SELECT id, payload_json
            FROM offline_sync_jobs
            WHERE status IN ('pending', 'failed')
              AND (next_retry_at IS NULL OR next_retry_at <= ?1)
            ORDER BY created_at ASC
            LIMIT ?2
            ",
        )
        .map_err(|e| format!("Prepare due jobs query failed: {e}"))?;

    let rows = stmt
        .query_map(params![now_iso(), limit], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Query due jobs failed: {e}"))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("Read due job row failed: {e}"))?);
    }
    Ok(out)
}

fn mark_syncing(conn: &Connection, job_id: &str) {
    let _ = conn.execute(
        "UPDATE offline_sync_jobs SET status = 'syncing', updated_at = ?1 WHERE id = ?2",
        params![now_iso(), job_id],
    );
}

fn mark_success(conn: &Connection, job_id: &str) {
    let _ = conn.execute("DELETE FROM offline_sync_jobs WHERE id = ?1", params![job_id]);
}

fn mark_failed(conn: &Connection, job_id: &str, error: &str) {
    let retries: i64 = conn
        .query_row(
            "SELECT retries FROM offline_sync_jobs WHERE id = ?1",
            params![job_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let next_retry = Utc::now() + chrono::Duration::seconds(next_retry_seconds(retries + 1));

    let _ = conn.execute(
        "
        UPDATE offline_sync_jobs
        SET status = 'failed',
            retries = retries + 1,
            next_retry_at = ?1,
            last_error = ?2,
            updated_at = ?3
        WHERE id = ?4
        ",
        params![next_retry.to_rfc3339(), error, now_iso(), job_id],
    );
}

fn sync_one(client: &Client, config: &SyncConfig, job_id: &str, payload_json: &str) -> Result<(), String> {
    let payload: OfflineSessionPayload =
        serde_json::from_str(payload_json).map_err(|e| format!("Invalid payload JSON: {e}"))?;

    let endpoint = format!(
        "{}/api/reliability/sync",
        config.api_base_url.trim_end_matches('/')
    );

    let mut req = client
        .post(endpoint)
        .json(&SyncEnvelope {
            job_id: job_id.to_string(),
            payload,
        })
        .header("content-type", "application/json");

    if let Some(secret) = &config.sync_secret {
        if !secret.trim().is_empty() {
            req = req.header("x-sync-secret", secret);
        }
    }

    let res = req
        .send()
        .map_err(|e| format!("Sync HTTP request failed: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().unwrap_or_default();
        return Err(format!("Sync rejected ({status}): {body}"));
    }

    Ok(())
}

fn worker_loop(db_path: PathBuf, config: Arc<Mutex<SyncConfig>>) {
    let client = match Client::builder().timeout(Duration::from_secs(20)).build() {
        Ok(client) => client,
        Err(error) => {
            log::error!("Reliability worker failed to build HTTP client: {}", error);
            return;
        }
    };

    loop {
        let conn = match Connection::open(&db_path) {
            Ok(conn) => conn,
            Err(error) => {
                log::error!("Reliability worker DB open failed: {}", error);
                std::thread::sleep(Duration::from_secs(10));
                continue;
            }
        };

        let jobs = match get_due_jobs(&conn, 8) {
            Ok(jobs) => jobs,
            Err(error) => {
                log::error!("Reliability worker due-jobs query failed: {}", error);
                std::thread::sleep(Duration::from_secs(10));
                continue;
            }
        };

        if jobs.is_empty() {
            std::thread::sleep(Duration::from_secs(6));
            continue;
        }

        let cfg = {
            let guard = config.lock();
            match guard {
                Ok(value) => value.clone(),
                Err(_) => {
                    log::error!("Reliability worker config lock poisoned");
                    std::thread::sleep(Duration::from_secs(10));
                    continue;
                }
            }
        };

        for (job_id, payload_json) in jobs {
            mark_syncing(&conn, &job_id);

            match sync_one(&client, &cfg, &job_id, &payload_json) {
                Ok(_) => {
                    mark_success(&conn, &job_id);
                    log::info!("Reliability worker synced job {}", job_id);
                }
                Err(error) => {
                    log::warn!("Reliability worker failed job {}: {}", job_id, error);
                    mark_failed(&conn, &job_id, &error);
                }
            }
        }
    }
}

pub fn setup_reliability(app: &tauri::App) -> Result<ReliabilityState, String> {
    let mut db_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Get app data directory failed: {e}"))?;

    std::fs::create_dir_all(&db_dir).map_err(|e| format!("Create app data directory failed: {e}"))?;

    db_dir.push("reliability");
    std::fs::create_dir_all(&db_dir).map_err(|e| format!("Create reliability directory failed: {e}"))?;

    let db_path = db_dir.join("offline_sync.sqlite");
    init_db(&db_path)?;

    let api_base_url = std::env::var("NEXT_PUBLIC_API_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "https://chronosnap.eagleies.com".to_string());

    let sync_secret = std::env::var("RELIABILITY_SYNC_SECRET")
        .ok()
        .filter(|v| !v.trim().is_empty());

    let config = Arc::new(Mutex::new(SyncConfig {
        api_base_url,
        sync_secret,
    }));

    let worker_db_path = db_path.clone();
    let worker_config = Arc::clone(&config);
    std::thread::spawn(move || worker_loop(worker_db_path, worker_config));

    Ok(ReliabilityState { db_path, config })
}

#[tauri::command]
pub fn queue_session_sync(
    state: tauri::State<'_, ReliabilityState>,
    payload: OfflineSessionPayload,
) -> Result<String, String> {
    let job_id = Uuid::new_v4().to_string();
    let conn = state.open_conn()?;
    let payload_json = serde_json::to_string(&payload)
        .map_err(|e| format!("Serialize queue payload failed: {e}"))?;

    conn.execute(
        "
        INSERT INTO offline_sync_jobs (id, kind, payload_json, status, retries, next_retry_at, last_error, created_at, updated_at)
        VALUES (?1, 'session_sync', ?2, 'pending', 0, NULL, NULL, ?3, ?3)
        ",
        params![job_id, payload_json, now_iso()],
    )
    .map_err(|e| format!("Insert queue job failed: {e}"))?;

    Ok(job_id)
}

#[tauri::command]
pub fn set_sync_config(
    state: tauri::State<'_, ReliabilityState>,
    api_base_url: String,
    sync_secret: Option<String>,
) -> Result<(), String> {
    if api_base_url.trim().is_empty() {
        return Err("api_base_url cannot be empty".to_string());
    }

    let mut guard = state
        .config
        .lock()
        .map_err(|_| "Failed to lock sync config".to_string())?;

    guard.api_base_url = api_base_url;
    guard.sync_secret = sync_secret.and_then(|v| {
        if v.trim().is_empty() {
            None
        } else {
            Some(v)
        }
    });

    Ok(())
}

#[tauri::command]
pub fn get_sync_queue_stats(state: tauri::State<'_, ReliabilityState>) -> Result<SyncQueueStats, String> {
    let conn = state.open_conn()?;

    let pending = conn
        .query_row(
            "SELECT COUNT(*) FROM offline_sync_jobs WHERE status = 'pending'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let syncing = conn
        .query_row(
            "SELECT COUNT(*) FROM offline_sync_jobs WHERE status = 'syncing'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let failed = conn
        .query_row(
            "SELECT COUNT(*) FROM offline_sync_jobs WHERE status = 'failed'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(SyncQueueStats {
        pending,
        syncing,
        failed,
    })
}
