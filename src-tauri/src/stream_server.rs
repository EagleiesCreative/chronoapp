use crossbeam_channel::{Receiver, RecvTimeoutError};
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tiny_http::{Response, Server, StatusCode};

/// Serves the camera live view as MJPEG on `/stream` (any query string is ignored, so the
/// frontend can cache-bust with `/stream?t=...`).
///
/// Each client runs on its own thread. A newly connected client always takes over: older
/// client loops see the generation change and exit. Previously the server handled one client
/// at a time, so a reconnect after the photo preview waited behind a dead connection and the
/// UI showed a frozen frame.
pub fn start_mjpeg_server(
    port: u16,
    frame_rx: Receiver<Vec<u8>>,
    running: Arc<AtomicBool>,
) -> Result<(), String> {
    let server_addr = format!("0.0.0.0:{}", port);
    let server = Server::http(&server_addr).map_err(|e| format!("Failed to start server: {}", e))?;
    log::info!("MJPEG Server listening on http://{}", server_addr);

    let generation = Arc::new(AtomicU64::new(0));

    for request in server.incoming_requests() {
        if !running.load(Ordering::SeqCst) {
            break;
        }

        let path = request.url().split('?').next().unwrap_or("").to_string();
        if path != "/stream" {
            let response = Response::from_string("Not Found").with_status_code(StatusCode(404));
            let _ = request.respond(response);
            continue;
        }

        let my_gen = generation.fetch_add(1, Ordering::SeqCst) + 1;
        let generation = generation.clone();
        let frame_rx = frame_rx.clone();
        let running = running.clone();
        log::info!("Client connected to /stream (gen {})", my_gen);

        std::thread::spawn(move || {
            let mut writer = request.into_writer();
            let headers = concat!(
                "HTTP/1.1 200 OK\r\n",
                "Content-Type: multipart/x-mixed-replace; boundary=--frame\r\n",
                "Cache-Control: no-cache, no-store, private\r\n",
                "Pragma: no-cache\r\n",
                "Connection: close\r\n\r\n"
            );
            if let Err(e) = writer.write_all(headers.as_bytes()) {
                log::error!("Failed to write stream response header: {}", e);
                return;
            }

            let mut last_frame: Option<Vec<u8>> = None;
            loop {
                if !running.load(Ordering::SeqCst) || generation.load(Ordering::SeqCst) != my_gen {
                    break;
                }

                let frame = match frame_rx.recv_timeout(Duration::from_millis(500)) {
                    Ok(jpeg) => {
                        last_frame = Some(jpeg.clone());
                        jpeg
                    }
                    // No new frame (camera busy capturing): resend the last one so a dead
                    // socket is detected instead of hanging this thread forever.
                    Err(RecvTimeoutError::Timeout) => match &last_frame {
                        Some(f) => f.clone(),
                        None => continue,
                    },
                    Err(RecvTimeoutError::Disconnected) => {
                        log::info!("Frame channel disconnected");
                        break;
                    }
                };

                let ok = writer.write_all(b"--frame\r\nContent-Type: image/jpeg\r\n").is_ok()
                    && write!(writer, "Content-Length: {}\r\n\r\n", frame.len()).is_ok()
                    && writer.write_all(&frame).is_ok()
                    && writer.write_all(b"\r\n").is_ok()
                    && writer.flush().is_ok();
                if !ok {
                    log::info!("Client disconnected from stream (gen {})", my_gen);
                    break;
                }
            }
            log::info!("Stream session ended (gen {}).", my_gen);
        });
    }

    Ok(())
}
