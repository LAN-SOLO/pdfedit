// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

/// Native "open file" dialog filtered to PDFs. Returns the chosen path
/// (None if the user cancels). Runs on the async pool — the blocking
/// dialog call must never run on the main thread.
#[tauri::command]
async fn pick_pdf(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .blocking_pick_file();
    Ok(picked
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().to_string()))
}

/// Read a PDF from disk and hand the raw bytes to the frontend
/// (tauri::ipc::Response arrives as an ArrayBuffer — no JSON detour).
#[tauri::command]
async fn read_pdf(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[derive(Serialize)]
pub struct UpdateInfoDto {
    pub version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// Check GitHub Releases (latest.json) for a newer version. Returns None when
/// the app is up to date; errors only on an unreachable/invalid endpoint.
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<Option<UpdateInfoDto>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfoDto {
            version: update.version.clone(),
            notes: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(format!("Update-Prüfung fehlgeschlagen: {e}")),
    }
}

/// Download, verify (signed) and install the update in place, then relaunch.
/// User data and settings live outside the app bundle and are untouched.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Update-Prüfung fehlgeschlagen: {e}"))?
        .ok_or("Kein Update verfügbar")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("Update fehlgeschlagen: {e}"))?;
    app.restart();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            pick_pdf,
            read_pdf,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running pdfedit");
}
