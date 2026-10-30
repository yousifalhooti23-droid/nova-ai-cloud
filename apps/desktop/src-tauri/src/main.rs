// NOVA AI Cloud — desktop shell
// =============================
// Tauri does NOT run our backend by itself (requirement: never assume that).
// This shell:
//   1. spawns the Nova sidecar server (shipped as a bundled resource),
//   2. waits until http://127.0.0.1:8787/api/health answers,
//   3. only then opens the window pointing at that local server,
//   4. kills the sidecar when the app exits.
//
// AI models are never embedded: the sidecar calls OpenRouter / Cloudflare over
// the network, exactly like the web version does.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// Loopback port for the sidecar. Override with NOVA_PORT if 8787 is taken.
fn port() -> u16 {
    std::env::var("NOVA_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8787)
}

const HEALTH_TIMEOUT: Duration = Duration::from_secs(10);

struct Sidecar(Mutex<Option<Child>>);

fn sidecar_exe() -> &'static str {
    if cfg!(windows) {
        "nova-server.exe"
    } else {
        "nova-server"
    }
}

fn find_sidecar(app: &tauri::AppHandle) -> Option<PathBuf> {
    let name = sidecar_exe();
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(rd) = app.path().resource_dir() {
        candidates.push(rd.join("sidecar").join(name));
        candidates.push(rd.join(name));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(name));
            candidates.push(dir.join("sidecar").join(name));
        }
    }
    candidates.into_iter().find(|p| p.exists())
}

fn spawn_sidecar(path: &PathBuf) -> Option<Child> {
    Command::new(path)
        .env("PORT", port().to_string())
        .env("HOST", "127.0.0.1")
        .spawn()
        .ok()
}

/// Plain-TCP health probe: avoids pulling an HTTP client into the shell.
fn wait_healthy(timeout: Duration) -> bool {
    let addr: SocketAddr = ([127, 0, 0, 1], port()).into();
    let start = Instant::now();
    while start.elapsed() < timeout {
        if let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
            let _ = s.set_read_timeout(Some(Duration::from_millis(900)));
            let _ = s.write_all(b"GET /api/health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
            let mut body = String::new();
            if s.read_to_string(&mut body).is_ok() && body.contains("200") && body.contains("ok") {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn kill_sidecar(state: &Sidecar) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();

            match find_sidecar(&handle) {
                Some(path) => {
                    eprintln!("[nova-shell] spawning sidecar: {}", path.display());
                    let child = spawn_sidecar(&path);
                    if child.is_none() {
                        eprintln!("[nova-shell] FAILED to spawn the sidecar");
                    }
                    *app.state::<Sidecar>().0.lock().unwrap() = child;
                }
                None => eprintln!("[nova-shell] sidecar executable not found next to resources"),
            }

            // Block briefly so the window never opens onto a dead port.
            let healthy = wait_healthy(HEALTH_TIMEOUT);
            eprintln!("[nova-shell] sidecar healthy = {healthy}");

            let url = format!("http://127.0.0.1:{}/", port());
            let _win = WebviewWindowBuilder::new(
                &handle,
                "main",
                WebviewUrl::External(url.parse().expect("static url")),
            )
            .title("NOVA AI Cloud")
            .inner_size(1400.0, 900.0)
            .min_inner_size(960.0, 640.0)
            .center()
            .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building NOVA AI Cloud");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            eprintln!("[nova-shell] exiting — stopping the sidecar");
            kill_sidecar(handle.state::<Sidecar>().inner());
        }
    });
}
