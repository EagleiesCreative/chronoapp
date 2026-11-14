use crossbeam_channel::{Receiver, RecvTimeoutError};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

/// Max simultaneous /stream viewers (on-screen live view + hidden Live Video recorder + slack).
/// Browsers allow only ~6 connections per host; leaked viewers used to use them all up so the
/// live view hung on "Connecting to camera…". The oldest viewer is dropped when this is exceeded.
const MAX_STREAM_CLIENTS: usize = 3;
/// A viewer that stops reading (browser kept the socket but no longer consumes it) is dropped.
const WRITE_TIMEOUT: Duration = Duration::from_secs(3);

struct FrameSlot {
    seq: u64,
    jpeg: Option<Arc<Vec<u8>>>,
}

type Slot = Arc<(Mutex<FrameSlot>, Condvar)>;
type ClientList = Arc<Mutex<VecDeque<(u64, Arc<AtomicBool>)>>>;

/// MJPEG live-view server on plain std::net so every socket gets a write timeout.
///   GET /stream[?anything]  multipart MJPEG (CORS enabled, so frames can be drawn to <canvas>)
///   GET /health             {"seq":N,"clients":M}
pub fn start_mjpeg_server(
    port: u16,
    frame_rx: Receiver<Vec<u8>>,
    running: Arc<AtomicBool>,
) -> Result<(), String> {
    let server_addr = format!("0.0.0.0:{}", port);
    let listener =
        TcpListener::bind(&server_addr).map_err(|e| format!("Failed to start server: {}", e))?;
    log::info!("MJPEG Server listening on http://{}", server_addr);

    let slot: Slot = Arc::new((Mutex::new(FrameSlot { seq: 0, jpeg: None }), Condvar::new()));
    let clients: ClientList = Arc::new(Mutex::new(VecDeque::new()));
    let client_count = Arc::new(AtomicU64::new(0));

    // Pump: camera channel -> shared slot. With no viewers the channel stays full, which tells
    // the camera thread to skip pulling live-view frames over USB.
    {
        let slot = slot.clone();
        let running = running.clone();
        let client_count = client_count.clone();
        std::thread::spawn(move || loop {
            if !running.load(Ordering::SeqCst) {
                break;
            }
            if client_count.load(Ordering::SeqCst) == 0 {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            match frame_rx.recv_timeout(Duration::from_millis(500)) {
                Ok(jpeg) => {
                    let (lock, cvar) = &*slot;
                    if let Ok(mut s) = lock.lock() {
                        s.seq = s.seq.wrapping_add(1);
                        s.jpeg = Some(Arc::new(jpeg));
                    }
                    cvar.notify_all();
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => {
                    log::info!("Frame channel disconnected");
                    break;
                }
            }
        });
    }

    let mut next_id: u64 = 0;
    for conn in listener.incoming() {
        if !running.load(Ordering::SeqCst) {
            break;
        }
        let Ok(stream) = conn else { continue };
        next_id += 1;
        let id = next_id;
        let slot = slot.clone();
        let clients = clients.clone();
        let client_count = client_count.clone();
        let running = running.clone();
        std::thread::spawn(move || {
            handle_connection(stream, id, slot, clients, client_count, running);
        });
    }
    Ok(())
}

fn read_request_path(stream: &mut TcpStream) -> Option<String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 || buf.len() > 16 * 1024 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let text = String::from_utf8_lossy(&buf);
    let mut parts = text.lines().next()?.split_whitespace();
    let _method = parts.next()?;
    let target = parts.next()?;
    Some(target.split('?').next().unwrap_or("").to_string())
}

fn handle_connection(
    mut stream: TcpStream,
    id: u64,
    slot: Slot,
    clients: ClientList,
    client_count: Arc<AtomicU64>,
    running: Arc<AtomicBool>,
) {
    let _ = stream.set_nodelay(true);
    let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
    let Some(path) = read_request_path(&mut stream) else { return };

    if path == "/health" {
        let seq = slot.0.lock().map(|s| s.seq).unwrap_or(0);
        let body = format!(
            "{{\"seq\":{},\"clients\":{}}}",
            seq,
            client_count.load(Ordering::SeqCst)
        );
        let _ = write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        return;
    }

    if path != "/stream" {
        let _ = stream.write_all(
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot Found",
        );
        return;
    }

    // Register; evict the oldest viewers beyond the cap.
    let kicked = Arc::new(AtomicBool::new(false));
    if let Ok(mut list) = clients.lock() {
        list.push_back((id, kicked.clone()));
        while list.len() > MAX_STREAM_CLIENTS {
            if let Some((old_id, old_flag)) = list.pop_front() {
                old_flag.store(true, Ordering::SeqCst);
                log::info!("Dropping stale stream client #{} (cap {})", old_id, MAX_STREAM_CLIENTS);
            }
        }
    }
    let n = client_count.fetch_add(1, Ordering::SeqCst) + 1;
    log::info!("Client connected to /stream (#{}, {} active)", id, n);

    let headers = concat!(
        "HTTP/1.1 200 OK\r\n",
        "Content-Type: multipart/x-mixed-replace; boundary=--frame\r\n",
        "Cache-Control: no-cache, no-store, private\r\n",
        "Pragma: no-cache\r\n",
        "Access-Control-Allow-Origin: *\r\n",
        "Connection: close\r\n\r\n"
    );

    if stream.write_all(headers.as_bytes()).is_ok() {
        let mut last_seq: u64 = 0;
        loop {
            if !running.load(Ordering::SeqCst) || kicked.load(Ordering::SeqCst) {
                break;
            }
            let frame = {
                let (lock, cvar) = &*slot;
                let Ok(guard) = lock.lock() else { break };
                let Ok((guard, _)) = cvar.wait_timeout_while(
                    guard,
                    Duration::from_millis(500),
                    |s| s.seq == last_seq,
                ) else {
                    break;
                };
                last_seq = guard.seq;
                guard.jpeg.clone()
            };
            // No new frame: resend the last one so a dead socket is detected.
            let Some(frame) = frame else { continue };

            let mut part = Vec::with_capacity(frame.len() + 96);
            let _ = write!(
                part,
                "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n",
                frame.len()
            );
            part.extend_from_slice(&frame);
            part.extend_from_slice(b"\r\n");
            if stream.write_all(&part).is_err() {
                break;
            }
        }
    }

    let _ = stream.shutdown(std::net::Shutdown::Both);
    if let Ok(mut list) = clients.lock() {
        list.retain(|(cid, _)| *cid != id);
    }
    let left = client_count.fetch_sub(1, Ordering::SeqCst) - 1;
    log::info!("Stream client #{} disconnected ({} active)", id, left);
}
