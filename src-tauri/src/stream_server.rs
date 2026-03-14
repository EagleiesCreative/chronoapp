use crossbeam_channel::{Receiver, RecvTimeoutError};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tiny_http::{Response, Server, StatusCode};

pub fn start_mjpeg_server(
    port: u16,
    frame_rx: Receiver<Vec<u8>>,
    running: Arc<AtomicBool>,
) -> Result<(), String> {
    let server_addr = format!("0.0.0.0:{}", port);
    let server = Server::http(&server_addr).map_err(|e| format!("Failed to start server: {}", e))?;
    log::info!("MJPEG Server listening on http://{}", server_addr);

    // We only ever expect one client (the local React app), but we handle it in a loop
    for request in server.incoming_requests() {
        if !running.load(Ordering::SeqCst) {
            break;
        }

        if request.url() == "/stream" {
            log::info!("Client connected to /stream");
            
            let mut writer = request.into_writer();
            
            // Write HTTP Headers manually
            let headers = concat!(
                "HTTP/1.1 200 OK\r\n",
                "Content-Type: multipart/x-mixed-replace; boundary=--frame\r\n",
                "Cache-Control: no-cache, private\r\n",
                "Pragma: no-cache\r\n",
                "Connection: close\r\n\r\n"
            );

            if let Err(e) = writer.write_all(headers.as_bytes()) {
                log::error!("Failed to write stream response header: {}", e);
                continue;
            }

            // Read frames from the channel and write to the client socket
            loop {
                if !running.load(Ordering::SeqCst) {
                    break;
                }

                match frame_rx.recv_timeout(Duration::from_millis(500)) {
                    Ok(jpeg_bytes) => {
                        // Write boundary
                        if let Err(_) = writer.write_all(b"--frame\r\n") {
                            log::info!("Client disconnected from stream");
                            break;
                        }
                        // Write headers
                        if let Err(_) = writer.write_all(b"Content-Type: image/jpeg\r\n") {
                            break;
                        }
                        if let Err(_) = write!(writer, "Content-Length: {}\r\n\r\n", jpeg_bytes.len()) {
                            break;
                        }
                        // Write JPEG payload
                        if let Err(_) = writer.write_all(&jpeg_bytes) {
                            break;
                        }
                        if let Err(_) = writer.write_all(b"\r\n") {
                            break;
                        }
                        let _ = writer.flush();
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        // Just loop around if no frame within 500ms
                        continue;
                    }
                    Err(RecvTimeoutError::Disconnected) => {
                        log::info!("Frame channel disconnected");
                        break;
                    }
                }
            }
            log::info!("Stream session ended.");
        } else {
            // 404 for other routes
            let response = Response::from_string("Not Found").with_status_code(StatusCode(404));
            let _ = request.respond(response);
        }
    }

    Ok(())
}
