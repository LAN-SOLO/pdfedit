// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Paths the frontend may write back to: only files the user picked in a
/// native dialog or opened (dialog / drag & drop). A compromised or buggy
/// webview can therefore never overwrite arbitrary files via `write_pdf`.
#[derive(Default)]
struct WritablePaths(Mutex<HashSet<PathBuf>>);

impl WritablePaths {
    /// Stores the path as given AND (once the file exists) its canonical
    /// form — a freshly chosen save target doesn't exist yet, and its
    /// canonical spelling can differ later (/var vs /private/var on macOS,
    /// the \\?\ prefix on Windows).
    fn allow(&self, p: &Path) {
        if let Ok(mut set) = self.0.lock() {
            set.insert(p.to_path_buf());
            if let Some(c) = canonical_key(p) {
                set.insert(c);
            }
        }
    }
    fn is_allowed(&self, p: &Path) -> bool {
        let Ok(set) = self.0.lock() else {
            return false;
        };
        set.contains(p) || canonical_key(p).map(|c| set.contains(&c)).unwrap_or(false)
    }
}

/// Canonical spelling of `p` — of the file itself when it exists, else of
/// its folder plus the file name (a save target that isn't written yet).
fn canonical_key(p: &Path) -> Option<PathBuf> {
    if let Ok(c) = std::fs::canonicalize(p) {
        return Some(c);
    }
    let parent = p.parent().filter(|d| !d.as_os_str().is_empty())?;
    Some(std::fs::canonicalize(parent).ok()?.join(p.file_name()?))
}

fn has_ext(p: &Path, want: &[&str]) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| want.iter().any(|w| e.eq_ignore_ascii_case(w)))
        .unwrap_or(false)
}

/// Appends `.pdf` when a save dialog returned a bare name (Windows/Linux
/// dialogs don't always add the filter's extension themselves).
fn ensure_pdf_ext(p: PathBuf) -> PathBuf {
    if has_ext(&p, &["pdf"]) {
        p
    } else {
        let mut s = p.into_os_string();
        s.push(".pdf");
        PathBuf::from(s)
    }
}

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
/// Only `.pdf` files — this must not double as a generic file reader. A
/// successfully opened PDF becomes writable for "Save" afterwards.
#[tauri::command]
async fn read_pdf(
    state: tauri::State<'_, WritablePaths>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let p = PathBuf::from(&path);
    if !has_ext(&p, &["pdf"]) {
        return Err("not a PDF file".into());
    }
    if !p.is_file() {
        return Err("file not found".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    state.allow(&p);
    Ok(tauri::ipc::Response::new(bytes))
}

/// Native "save file" dialog for a new PDF. Returns the chosen path
/// (None if the user cancels); the path is always `*.pdf`.
#[tauri::command]
async fn pick_save_pdf(
    app: tauri::AppHandle,
    state: tauri::State<'_, WritablePaths>,
    suggested: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .set_file_name(&suggested)
        .blocking_save_file();
    let path = picked.and_then(|f| f.into_path().ok()).map(ensure_pdf_ext);
    if let Some(p) = &path {
        state.allow(p);
    }
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

/// Writes `bytes` to `target` crash-safely: temp file in the same folder,
/// flushed, then renamed over the original — a crash or full disk mid-save
/// never leaves a half-written PDF behind. Symlinks are resolved first so
/// the link itself survives; the original file's permissions are kept.
fn write_atomic(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let target = std::fs::canonicalize(target).unwrap_or_else(|_| target.to_path_buf());
    let dir = target
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "pdf".into());
    let tmp = dir.join(format!(".{name}.pdfedit-{}.tmp", std::process::id()));
    let result = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        if let Ok(meta) = std::fs::metadata(&target) {
            let _ = std::fs::set_permissions(&tmp, meta.permissions());
        }
        std::fs::rename(&tmp, &target)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Write a PDF to disk (bytes arrive base64-encoded). Only to paths the
/// user chose or opened in this session, and only `*.pdf`.
#[tauri::command]
async fn write_pdf(
    state: tauri::State<'_, WritablePaths>,
    path: String,
    data_b64: String,
) -> Result<(), String> {
    use base64::Engine;
    let p = PathBuf::from(&path);
    if !has_ext(&p, &["pdf"]) || !state.is_allowed(&p) {
        return Err("write denied: path was not opened or chosen in this session".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"%PDF-") {
        return Err("refusing to write: data is not a PDF".into());
    }
    write_atomic(&p, &bytes).map_err(|e| e.to_string())?;
    state.allow(&p);
    Ok(())
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

/// The OS font folders `list_system_fonts` enumerates — also the only
/// places `read_font` may read from.
fn font_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        dirs.push("/System/Library/Fonts".into());
        dirs.push("/System/Library/Fonts/Supplemental".into());
        dirs.push("/Library/Fonts".into());
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join("Library/Fonts"));
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(win) = std::env::var_os("WINDIR") {
            dirs.push(PathBuf::from(win).join("Fonts"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join("Microsoft").join("Windows").join("Fonts"));
        }
    }
    #[cfg(target_os = "linux")]
    {
        dirs.push("/usr/share/fonts".into());
        dirs.push("/usr/local/share/fonts".into());
        if let Some(home) = std::env::var_os("HOME") {
            dirs.push(PathBuf::from(&home).join(".fonts"));
            dirs.push(PathBuf::from(&home).join(".local/share/fonts"));
        }
    }

    dirs
}

/// Enumerate installed system fonts (TTF/OTF only — TrueType collections
/// and bitmap formats are skipped because the embedding pipeline in the
/// frontend can't subset them). Reads real family/style names from each
/// font's name table so the picker shows "Arial — Bold" instead of file
/// stems, and so the text editor can match a document's original font.
#[tauri::command]
async fn list_system_fonts() -> Result<Vec<SystemFontDto>, String> {
    let dirs = font_dirs();
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

/// True when `path` is a .ttf/.otf file inside one of the OS font folders
/// (after resolving symlinks and `..`).
fn is_allowed_font(path: &Path, dirs: &[PathBuf]) -> bool {
    if !has_ext(path, &["ttf", "otf"]) {
        return false;
    }
    let Ok(real) = std::fs::canonicalize(path) else {
        return false;
    };
    real.is_file()
        && dirs
            .iter()
            .filter_map(|d| std::fs::canonicalize(d).ok())
            .any(|d| real.starts_with(d))
}

/// Read a font file's raw bytes (for embedding into the PDF). Restricted to
/// .ttf/.otf inside the system font folders so this command can't be used
/// as a generic file reader.
#[tauri::command]
async fn read_font(path: String) -> Result<tauri::ipc::Response, String> {
    let p = PathBuf::from(&path);
    if !is_allowed_font(&p, &font_dirs()) {
        return Err("not a system font file".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
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
        .manage(WritablePaths::default())
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
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pdfedit-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn extension_checks_are_case_insensitive() {
        assert!(has_ext(Path::new("a/b/Report.PDF"), &["pdf"]));
        assert!(has_ext(Path::new(r"C:\Users\x\file.pdf"), &["pdf"]));
        assert!(!has_ext(Path::new("notes.pdf.txt"), &["pdf"]));
        assert!(!has_ext(Path::new("noext"), &["pdf"]));
        assert!(has_ext(Path::new("Font.OTF"), &["ttf", "otf"]));
    }

    #[test]
    fn save_paths_always_end_in_pdf() {
        assert_eq!(ensure_pdf_ext(PathBuf::from("dir/Unbenannt")), PathBuf::from("dir/Unbenannt.pdf"));
        assert_eq!(ensure_pdf_ext(PathBuf::from("dir/x.PDF")), PathBuf::from("dir/x.PDF"));
        assert_eq!(ensure_pdf_ext(PathBuf::from("dir/v1.2")), PathBuf::from("dir/v1.2.pdf"));
    }

    #[test]
    fn writable_paths_only_after_allow() {
        let d = scratch("allow");
        let f = d.join("doc.pdf");
        let w = WritablePaths::default();
        assert!(!w.is_allowed(&f));
        w.allow(&f); // not yet on disk (fresh save target)
        assert!(w.is_allowed(&f));
        std::fs::write(&f, b"%PDF-1.7").unwrap();
        // canonical spelling (macOS /private/var, Windows \\?\) still matches
        let canon = std::fs::canonicalize(&f).unwrap();
        assert!(w.is_allowed(&canon));
        assert!(!w.is_allowed(&d.join("other.pdf")));
        // a `..` detour to the same file resolves to the allowed one
        let detour = d.join("sub").join("..").join("doc.pdf");
        std::fs::create_dir_all(d.join("sub")).unwrap();
        assert!(w.is_allowed(&detour));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp() {
        let d = scratch("atomic");
        let f = d.join("out.pdf");
        std::fs::write(&f, b"%PDF-old").unwrap();
        write_atomic(&f, b"%PDF-new content").unwrap();
        assert_eq!(std::fs::read(&f).unwrap(), b"%PDF-new content");
        write_atomic(&d.join("fresh.pdf"), b"%PDF-1").unwrap();
        let names: Vec<String> = std::fs::read_dir(&d)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert!(names.iter().all(|n| !n.ends_with(".tmp")), "{names:?}");
        assert_eq!(names.len(), 2);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn atomic_write_fails_cleanly_for_missing_dir() {
        let d = scratch("missing");
        let target = d.join("nope").join("x.pdf");
        assert!(write_atomic(&target, b"%PDF-1").is_err());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn fonts_only_from_font_dirs() {
        let d = scratch("fonts");
        let fonts = d.join("Fonts");
        std::fs::create_dir_all(&fonts).unwrap();
        let good = fonts.join("A.ttf");
        std::fs::write(&good, b"x").unwrap();
        let outside = d.join("secret.ttf");
        std::fs::write(&outside, b"x").unwrap();
        let txt = fonts.join("readme.txt");
        std::fs::write(&txt, b"x").unwrap();
        let dirs = vec![fonts.clone()];
        assert!(is_allowed_font(&good, &dirs));
        assert!(!is_allowed_font(&outside, &dirs));
        assert!(!is_allowed_font(&txt, &dirs));
        // traversal out of the font folder is caught after canonicalisation
        assert!(!is_allowed_font(&fonts.join("..").join("secret.ttf"), &dirs));
        assert!(!is_allowed_font(&fonts.join("missing.ttf"), &dirs));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn font_name_parser_rejects_garbage() {
        assert!(parse_font_names(b"").is_none());
        assert!(parse_font_names(b"not a font at all").is_none());
        // valid magic but truncated table directory must not panic
        let mut b = vec![0u8, 1, 0, 0, 0, 5];
        b.extend_from_slice(&[0u8; 10]);
        assert!(parse_font_names(&b).is_none());
    }

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
