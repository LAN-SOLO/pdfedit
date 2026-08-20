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

/// Native "save file" dialog for a new PDF. Returns the chosen path
/// (None if the user cancels).
#[tauri::command]
async fn pick_save_pdf(app: tauri::AppHandle, suggested: String) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .set_file_name(&suggested)
        .blocking_save_file();
    Ok(picked
        .and_then(|f| f.into_path().ok())
        .map(|p| p.to_string_lossy().to_string()))
}

/// Write a freshly created PDF to disk (bytes arrive base64-encoded —
/// blank documents are tiny, the encoding overhead is irrelevant).
#[tauri::command]
async fn write_pdf(path: String, data_b64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct SystemFontDto {
    /// Display name (full name from the name table, falls back to the stem).
    pub name: String,
    /// Family name ("Arial") — empty when the name table couldn't be read.
    pub family: String,
    /// Subfamily/style ("Bold", "Italic", "Bold Italic", "Regular", …).
    pub style: String,
    pub path: String,
}

/// Reads family (nameID 1), subfamily (2) and full name (4) from a
/// TTF/OTF `name` table. Enough for the text editor's font matching —
/// three strings don't justify a font crate.
fn parse_font_names(bytes: &[u8]) -> Option<(String, String, String)> {
    let u16at = |o: usize| -> Option<u16> {
        bytes.get(o..o + 2).map(|b| u16::from_be_bytes([b[0], b[1]]))
    };
    let u32at = |o: usize| -> Option<u32> {
        bytes
            .get(o..o + 4)
            .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    };
    let magic = u32at(0)?;
    if magic != 0x0001_0000
        && magic != u32::from_be_bytes(*b"OTTO")
        && magic != u32::from_be_bytes(*b"true")
    {
        return None;
    }
    let num_tables = u16at(4)? as usize;
    let mut name_off = None;
    for i in 0..num_tables {
        let rec = 12 + i * 16;
        if bytes.get(rec..rec + 4)? == b"name" {
            name_off = Some(u32at(rec + 8)? as usize);
            break;
        }
    }
    let base = name_off?;
    let count = u16at(base + 2)? as usize;
    let string_off = base + u16at(base + 4)? as usize;
    let mut family: Option<String> = None;
    let mut sub: Option<String> = None;
    let mut full: Option<String> = None;
    for i in 0..count {
        let rec = base + 6 + i * 12;
        let platform = u16at(rec)?;
        let name_id = u16at(rec + 6)?;
        if !matches!(name_id, 1 | 2 | 4) {
            continue;
        }
        let len = u16at(rec + 8)? as usize;
        let off = string_off + u16at(rec + 10)? as usize;
        let Some(raw) = bytes.get(off..off + len) else {
            continue;
        };
        // Windows/Unicode entries are UTF-16BE, Mac entries ~ASCII.
        let text = if platform == 3 || platform == 0 {
            let units: Vec<u16> = raw
                .chunks_exact(2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&units)
        } else {
            raw.iter().map(|&b| b as char).collect()
        };
        let text = text.trim().to_string();
        if text.is_empty() {
            continue;
        }
        let slot = match name_id {
            1 => &mut family,
            2 => &mut sub,
            _ => &mut full,
        };
        // Windows entries win over Mac ones read earlier
        if slot.is_none() || platform == 3 {
            *slot = Some(text);
        }
    }
    Some((
        family.unwrap_or_default(),
        sub.unwrap_or_default(),
        full.unwrap_or_default(),
    ))
}

/// Enumerate installed system fonts (TTF/OTF only — TrueType collections
/// and bitmap formats are skipped because the embedding pipeline in the
/// frontend can't subset them). Reads real family/style names from each
/// font's name table so the picker shows "Arial — Bold" instead of file
/// stems, and so the text editor can match a document's original font.
#[tauri::command]
async fn list_system_fonts() -> Result<Vec<SystemFontDto>, String> {
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        dirs.push("/System/Library/Fonts".into());
        dirs.push("/System/Library/Fonts/Supplemental".into());
        dirs.push("/Library/Fonts".into());
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(std::path::PathBuf::from(home).join("Library/Fonts"));
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(win) = std::env::var_os("WINDIR") {
            dirs.push(std::path::PathBuf::from(win).join("Fonts"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(std::path::PathBuf::from(local).join("Microsoft/Windows/Fonts"));
        }
    }
    #[cfg(target_os = "linux")]
    {
        dirs.push("/usr/share/fonts".into());
        dirs.push("/usr/local/share/fonts".into());
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(std::path::PathBuf::from(&home).join(".fonts"));
            dirs.push(std::path::PathBuf::from(&home).join(".local/share/fonts"));
        }
    }

    let mut fonts: Vec<SystemFontDto> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for dir in dirs {
        collect_fonts(&dir, 0, &mut fonts, &mut seen);
    }
    fonts.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(fonts)
}

fn collect_fonts(
    dir: &std::path::Path,
    depth: u8,
    out: &mut Vec<SystemFontDto>,
    seen: &mut std::collections::HashSet<String>,
) {
    if depth > 2 {
        return; // Linux font dirs nest by family; anything deeper is noise
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_fonts(&path, depth + 1, out, seen);
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase());
        if !matches!(ext.as_deref(), Some("ttf") | Some("otf")) {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        // Only the first 64 KiB are needed for the name table in practice —
        // avoids reading hundreds of full font files during enumeration.
        let names = std::fs::File::open(&path)
            .ok()
            .and_then(|mut f| {
                use std::io::Read;
                let mut head = vec![0u8; 64 * 1024];
                let n = f.read(&mut head).ok()?;
                head.truncate(n);
                parse_font_names(&head)
            });
        let (family, style, full) = names.unwrap_or_default();
        let display = if !full.is_empty() {
            full
        } else if !family.is_empty() {
            if style.is_empty() || style.eq_ignore_ascii_case("regular") {
                family.clone()
            } else {
                format!("{family} {style}")
            }
        } else {
            stem.to_string()
        };
        if seen.insert(display.to_lowercase()) {
            out.push(SystemFontDto {
                name: display,
                family,
                style,
                path: path.to_string_lossy().to_string(),
            });
        }
    }
}

/// Read a font file's raw bytes (for embedding into the PDF). Restricted to
/// .ttf/.otf so this command can't be used as a generic file reader.
#[tauri::command]
async fn read_font(path: String) -> Result<tauri::ipc::Response, String> {
    let lower = path.to_lowercase();
    if !lower.ends_with(".ttf") && !lower.ends_with(".otf") {
        return Err("not a font file".into());
    }
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
            pick_save_pdf,
            write_pdf,
            list_system_fonts,
            read_font,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running pdfedit");
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_real_font_names() {
        for (path, want_family) in [
            ("/System/Library/Fonts/Supplemental/Arial.ttf", "Arial"),
            ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "Arial"),
        ] {
            let Ok(bytes) = std::fs::read(path) else { continue };
            let (family, style, full) = super::parse_font_names(&bytes).expect("parse");
            assert_eq!(family, want_family, "family for {path}");
            assert!(!full.is_empty(), "full name for {path}");
            eprintln!("{path}: family={family} style={style} full={full}");
        }
    }
}
