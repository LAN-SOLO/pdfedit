// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// A set of paths the user granted in this session. Two instances live in
/// the app state:
/// * [`ReadablePaths`] — files the user picked in a native dialog, dropped
///   onto the window (registered in Rust from the window event, not by the
///   frontend) or saved. `read_pdf` only reads these, so a compromised
///   webview can't read arbitrary PDFs off the disk.
/// * [`WritablePaths`] — files that were opened or chosen as a save target.
///   `write_pdf` only writes these, so it can't overwrite arbitrary files.
#[derive(Default)]
struct PathSet(Mutex<HashSet<PathBuf>>);

#[derive(Default)]
struct ReadablePaths(PathSet);
#[derive(Default)]
struct WritablePaths(PathSet);

impl PathSet {
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

/// Error strings crossing the IPC boundary are stable codes (`area.what`,
/// optionally `: detail`) — the frontend maps them to German/English text
/// (src/errors.ts). Raw OS/updater text only ever appears as the detail.
fn io_code(e: &std::io::Error) -> String {
    use std::io::ErrorKind;
    if is_lock_error(e) {
        return format!("io.locked: {e}");
    }
    // ENOSPC (unix) / ERROR_DISK_FULL, ERROR_HANDLE_DISK_FULL (Windows)
    let full = if cfg!(windows) {
        matches!(e.raw_os_error(), Some(112) | Some(39))
    } else {
        e.raw_os_error() == Some(28)
    };
    if full || e.kind() == ErrorKind::StorageFull {
        return format!("io.full: {e}");
    }
    match e.kind() {
        ErrorKind::NotFound => format!("io.not_found: {e}"),
        ErrorKind::PermissionDenied => format!("io.denied: {e}"),
        ErrorKind::ReadOnlyFilesystem => format!("io.denied: {e}"),
        _ => format!("io.other: {e}"),
    }
}

/// Windows: ERROR_SHARING_VIOLATION (32) / ERROR_LOCK_VIOLATION (33) — the
/// file is held open by another program (Acrobat, Office, an AV scanner,
/// OneDrive sync). Never true elsewhere.
fn is_lock_error(e: &std::io::Error) -> bool {
    cfg!(windows) && matches!(e.raw_os_error(), Some(32) | Some(33))
}

/// Windows: errors worth retrying for a moment — sharing/lock violations
/// and ERROR_ACCESS_DENIED (5), which `MoveFileEx` also reports while a
/// scanner or sync client briefly holds the target or the fresh temp file.
fn is_transient_fs_error(e: &std::io::Error) -> bool {
    cfg!(windows) && matches!(e.raw_os_error(), Some(5) | Some(32) | Some(33))
}

/// Runs `op` and retries it (≈ 2 s in total, growing pauses) as long as it
/// fails with an error `transient` accepts. Returns the last error.
fn retry_io<T>(
    mut op: impl FnMut() -> std::io::Result<T>,
    transient: impl Fn(&std::io::Error) -> bool,
) -> std::io::Result<T> {
    let mut delay = 25u64;
    let mut waited = 0u64;
    loop {
        match op() {
            Err(e) if transient(&e) && waited < 2000 => {
                std::thread::sleep(std::time::Duration::from_millis(delay));
                waited += delay;
                delay = (delay * 2).min(400);
            }
            other => return other,
        }
    }
}

/// Windows device names (CON, PRN, AUX, NUL, COM0–9, LPT0–9, also with an
/// extension: `NUL.pdf` still opens the device) and names ending in a dot
/// or space, which Windows silently strips. Writing to such a "file" goes
/// to a device or a different name — refuse it in the backend instead of
/// trusting the dialog. Applied on Windows only.
fn is_unsafe_windows_name(p: &Path) -> bool {
    let Some(name) = p.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if name.ends_with('.') || name.ends_with(' ') {
        return true;
    }
    let stem = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit())
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
/// (None if the user cancels) and grants `read_pdf` for it. Runs on the
/// async pool — the blocking dialog call must never run on the main thread.
#[tauri::command]
async fn pick_pdf(
    app: tauri::AppHandle,
    readable: tauri::State<'_, ReadablePaths>,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .blocking_pick_file();
    let path = picked.and_then(|f| f.into_path().ok());
    if let Some(p) = &path {
        readable.0.allow(p);
    }
    Ok(path.map(|p| p.to_string_lossy().to_string()))
}

/// Read a PDF from disk and hand the raw bytes to the frontend
/// (tauri::ipc::Response arrives as an ArrayBuffer — no JSON detour).
/// Only `.pdf` files the user picked, dropped or saved in this session —
/// this must not double as a generic file reader. A successfully opened
/// PDF becomes writable for "Save" afterwards. The file IO runs on the
/// blocking pool so a large file never stalls the async runtime.
#[tauri::command]
async fn read_pdf(
    readable: tauri::State<'_, ReadablePaths>,
    writable: tauri::State<'_, WritablePaths>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let p = PathBuf::from(&path);
    if !has_ext(&p, &["pdf"]) {
        return Err("pdf.not_pdf".into());
    }
    if !readable.0.is_allowed(&p) {
        return Err("pdf.read_denied".into());
    }
    let rp = p.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || read_pdf_file(&rp))
        .await
        .map_err(|e| format!("io.other: {e}"))??;
    writable.0.allow(&p);
    Ok(tauri::ipc::Response::new(bytes))
}

fn read_pdf_file(p: &Path) -> Result<Vec<u8>, String> {
    if !p.is_file() {
        return Err("pdf.not_found".into());
    }
    retry_io(|| std::fs::read(p), is_lock_error).map_err(|e| io_code(&e))
}

/// Native "save file" dialog for a new PDF. Returns the chosen path
/// (None if the user cancels); the path is always `*.pdf`. When the dialog
/// returned a bare name and `pdfedit` appends `.pdf`, the OS dialog never
/// asked about *that* file — if it exists, ask here before it's replaced
/// (`replace_msg` contains `{name}`; labels come from the UI language).
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri injects app/window/state
async fn pick_save_pdf(
    app: tauri::AppHandle,
    window: tauri::Window,
    readable: tauri::State<'_, ReadablePaths>,
    writable: tauri::State<'_, WritablePaths>,
    suggested: String,
    replace_msg: String,
    replace_label: String,
    cancel_label: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("PDF", &["pdf"])
        .set_file_name(&suggested)
        .set_parent(&window)
        .blocking_save_file();
    let Some(raw) = picked.and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    let path = ensure_pdf_ext(raw.clone());
    if path != raw && path.exists() {
        use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind};
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let replace = window
            .dialog()
            .message(replace_msg.replace("{name}", &name))
            .title("pdfedit")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(replace_label, cancel_label))
            .parent(&window)
            .blocking_show();
        if !replace {
            return Ok(None);
        }
    }
    writable.0.allow(&path);
    readable.0.allow(&path);
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Writes `bytes` to `target` crash-safely: temp file in the same folder,
/// flushed, then renamed over the original — a crash or full disk mid-save
/// never leaves a half-written PDF behind. Symlinks are resolved first so
/// the link itself survives; the original file's permissions are kept.
/// On Windows the final rename is retried for a moment while another
/// program (virus scanner, OneDrive, a viewer) briefly holds the file.
fn write_atomic(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let target = std::fs::canonicalize(target).unwrap_or_else(|_| target.to_path_buf());
    let dir = target
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    // Keep the temp name short: a 200+ character file name plus the suffix
    // would exceed the 255-unit component limit (NTFS/APFS/ext4). The
    // sequence number keeps two saves in flight from sharing a temp file.
    let name: String = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "pdf".into())
        .chars()
        .take(60)
        .collect();
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!(".{name}.pdfedit-{}-{seq}.tmp", std::process::id()));
    let result = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        if let Ok(meta) = std::fs::metadata(&target) {
            let _ = std::fs::set_permissions(&tmp, meta.permissions());
        }
        retry_io(|| std::fs::rename(&tmp, &target), is_transient_fs_error)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Write a PDF to disk (bytes arrive base64-encoded). Only to paths the
/// user chose or opened in this session, and only `*.pdf`. Decoding and
/// the disk write run on the blocking pool.
#[tauri::command]
async fn write_pdf(
    readable: tauri::State<'_, ReadablePaths>,
    writable: tauri::State<'_, WritablePaths>,
    path: String,
    data_b64: String,
) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !has_ext(&p, &["pdf"]) || !writable.0.is_allowed(&p) {
        return Err("pdf.write_denied".into());
    }
    if cfg!(windows) && is_unsafe_windows_name(&p) {
        return Err("pdf.bad_name".into());
    }
    let wp = p.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data_b64)
            .map_err(|_| "pdf.bad_data".to_string())?;
        if !bytes.starts_with(b"%PDF-") {
            return Err("pdf.bad_data".to_string());
        }
        write_atomic(&wp, &bytes).map_err(|e| io_code(&e))
    })
    .await
    .map_err(|e| format!("io.other: {e}"))??;
    writable.0.allow(&p);
    readable.0.allow(&p);
    Ok(())
}

/// Native OK/Cancel question ("discard unsaved changes?"). `window.confirm`
/// can't be used inside Tauri: the dialog plugin replaces it with an async
/// stub that returns a Promise (always truthy, so every unsaved-changes
/// guard would silently pass) and calls a command the plugin no longer has.
#[tauri::command]
async fn confirm_dialog(
    window: tauri::Window,
    message: String,
    ok_label: String,
    cancel_label: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind};
    Ok(window
        .dialog()
        .message(message)
        .title("pdfedit")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(ok_label, cancel_label))
        .parent(&window)
        .blocking_show())
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
    // hundreds of font files are opened — keep that off the async workers
    tauri::async_runtime::spawn_blocking(|| {
        let mut fonts: Vec<SystemFontDto> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for dir in font_dirs() {
            collect_fonts(&dir, 0, &mut fonts, &mut seen);
        }
        fonts.sort_by_cached_key(|f| f.name.to_lowercase());
        fonts
    })
    .await
    .map_err(|e| format!("io.other: {e}"))
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
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        if !is_allowed_font(&p, &font_dirs()) {
            return Err("font.denied".to_string());
        }
        std::fs::read(&p).map_err(|e| io_code(&e))
    })
    .await
    .map_err(|e| format!("io.other: {e}"))??;
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
    let updater = app.updater().map_err(|e| format!("update.check: {e}"))?;
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfoDto {
            version: update.version.clone(),
            notes: update.body.clone(),
            // `time`'s Display ("2026-10-19 12:00:00.0 +00:00:00") — the
            // frontend parses it (src/updateDate.ts)
            date: update.date.map(|d| d.to_string()),
        })),
        Ok(None) => Ok(None),
        Err(e) => Err(format!("update.check: {e}")),
    }
}

/// Download, verify (signed) and install the update in place, then relaunch.
/// User data and settings live outside the app bundle and are untouched.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| format!("update.check: {e}"))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("update.check: {e}"))?
        .ok_or("update.none")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("update.install: {e}"))?;
    app.restart();
}

/// True for URLs that belong to the app itself: `tauri://localhost`
/// (macOS/Linux), `http(s)://tauri.localhost` (Windows/WebView2) and, in
/// debug builds, the Vite dev server. Everything else — a web link inside
/// a PDF, `mailto:`, `file:` — must never replace the app's page: the
/// editor and its unsaved tabs would be gone without any question.
fn is_app_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            let host = url.host_str().unwrap_or("");
            host == "tauri.localhost"
                || (cfg!(debug_assertions)
                    && (host == "localhost" || host == "127.0.0.1")
                    && url.port() == Some(1420))
        }
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

/// Blocks every top-level navigation away from the app (see
/// [`is_app_url`]). The frontend catches link clicks in PDFs itself and
/// copies the address instead; this is the backstop for anything else.
fn nav_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("pdfedit-nav-guard")
        .on_navigation(|_, url| is_app_url(url))
        .build()
}

fn main() {
    tauri::Builder::default()
        .plugin(nav_guard())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ReadablePaths::default())
        .manage(WritablePaths::default())
        // Files dropped onto the window become readable here, in Rust —
        // this handler runs synchronously right after the drop event is
        // emitted to the webview, before its `read_pdf` call can arrive.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let readable = window.state::<ReadablePaths>();
                for p in paths.iter().filter(|p| has_ext(p, &["pdf"])) {
                    readable.0.allow(p);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            pick_pdf,
            read_pdf,
            pick_save_pdf,
            write_pdf,
            confirm_dialog,
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
        let w = PathSet::default();
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
    fn unicode_and_space_paths_work() {
        let d = scratch("unicode");
        let dir = d.join("Ordner mit Ä ü ß");
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("Bericht März 2026.PDF");
        let w = PathSet::default();
        w.allow(&f);
        assert!(w.is_allowed(&f));
        write_atomic(&f, b"%PDF-1.7 umlaut").unwrap();
        assert_eq!(std::fs::read(&f).unwrap(), b"%PDF-1.7 umlaut");
        write_atomic(&f, b"%PDF-1.7 again").unwrap();
        assert_eq!(std::fs::read(&f).unwrap(), b"%PDF-1.7 again");
        assert!(w.is_allowed(&std::fs::canonicalize(&f).unwrap()));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
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
    #[test]
    fn windows_device_names_are_refused() {
        for bad in ["CON.pdf", "nul.pdf", "Aux.PDF", "COM1.pdf", "lpt9.pdf", "PRN", "x.pdf.", "x.pdf "] {
            assert!(is_unsafe_windows_name(Path::new(bad)), "{bad}");
        }
        for ok in ["Bericht.pdf", "CONTRACT.pdf", "Konto.pdf", "COM.pdf", "COM10.pdf", "nullen.pdf", "Bericht März 2026.pdf"] {
            assert!(!is_unsafe_windows_name(Path::new(ok)), "{ok}");
        }
        assert!(is_unsafe_windows_name(&Path::new("dir").join("con.pdf")));
    }

    #[test]
    fn only_app_urls_may_be_navigated_to() {
        let ok = |u: &str| is_app_url(&tauri::Url::parse(u).unwrap());
        assert!(ok("tauri://localhost/"));
        assert!(ok("tauri://localhost/index.html#page=2"));
        assert!(ok("http://tauri.localhost/"));
        assert!(ok("https://tauri.localhost/assets/x.js"));
        assert!(ok("about:blank"));
        assert!(!ok("https://example.com/"));
        assert!(!ok("http://tauri.localhost.evil.com/"));
        assert!(!ok("tauri://evil/"));
        assert!(!ok("mailto:a@b.de"));
        assert!(!ok("file:///etc/passwd"));
        assert!(!ok("javascript:alert(1)"));
        assert!(!ok("data:text/html,hi"));
        assert!(!ok("http://localhost:8080/"));
        // the dev server only in debug builds (tests are debug)
        assert_eq!(ok("http://localhost:1420/"), cfg!(debug_assertions));
    }

    #[test]
    fn retry_io_retries_only_transient_errors() {
        use std::io::{Error, ErrorKind};
        // a lock that clears after three attempts — the call succeeds
        let mut calls = 0;
        let r = retry_io(
            || {
                calls += 1;
                if calls < 4 {
                    Err(Error::from(ErrorKind::WouldBlock))
                } else {
                    Ok(calls)
                }
            },
            |e| e.kind() == ErrorKind::WouldBlock,
        );
        assert_eq!(r.unwrap(), 4);
        // a permanent error is returned at once
        let mut calls = 0;
        let r: std::io::Result<()> = retry_io(
            || {
                calls += 1;
                Err(Error::from(ErrorKind::NotFound))
            },
            |e| e.kind() == ErrorKind::WouldBlock,
        );
        assert!(r.is_err());
        assert_eq!(calls, 1);
        // a lock that never clears gives up after ~2 s with the last error
        let t0 = std::time::Instant::now();
        let r: std::io::Result<()> =
            retry_io(|| Err(Error::from(ErrorKind::WouldBlock)), |_| true);
        assert_eq!(r.unwrap_err().kind(), ErrorKind::WouldBlock);
        assert!(t0.elapsed() < std::time::Duration::from_secs(4));
    }

    #[test]
    fn io_errors_become_stable_codes() {
        use std::io::{Error, ErrorKind};
        assert!(io_code(&Error::from(ErrorKind::NotFound)).starts_with("io.not_found"));
        assert!(io_code(&Error::from(ErrorKind::PermissionDenied)).starts_with("io.denied"));
        assert!(io_code(&Error::other("x")).starts_with("io.other: "));
        #[cfg(unix)]
        assert!(io_code(&Error::from_raw_os_error(28)).starts_with("io.full"));
        #[cfg(windows)]
        {
            assert!(io_code(&Error::from_raw_os_error(32)).starts_with("io.locked"));
            assert!(io_code(&Error::from_raw_os_error(112)).starts_with("io.full"));
            assert!(is_transient_fs_error(&Error::from_raw_os_error(5)));
        }
        #[cfg(not(windows))]
        assert!(!is_transient_fs_error(&Error::from(ErrorKind::PermissionDenied)));
    }

    #[test]
    fn atomic_write_handles_long_names() {
        let d = scratch("longname");
        // 240 characters + ".pdf" — legal, but name + temp suffix would not be
        let f = d.join(format!("{}.pdf", "ä".repeat(120)));
        let long = d.join(format!("{}.pdf", "x".repeat(240)));
        write_atomic(&long, b"%PDF-long").unwrap();
        assert_eq!(std::fs::read(&long).unwrap(), b"%PDF-long");
        write_atomic(&f, b"%PDF-umlaut").unwrap();
        assert_eq!(std::fs::read(&f).unwrap(), b"%PDF-umlaut");
        assert_eq!(std::fs::read_dir(&d).unwrap().count(), 2);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn parallel_atomic_writes_do_not_share_a_temp_file() {
        let d = scratch("parallel");
        let f = d.join("same.pdf");
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let f = f.clone();
                std::thread::spawn(move || write_atomic(&f, format!("%PDF-{i}").as_bytes()))
            })
            .collect();
        for h in handles {
            h.join().unwrap().unwrap();
        }
        let content = std::fs::read(&f).unwrap();
        assert!(content.starts_with(b"%PDF-") && content.len() == 6, "{content:?}");
        assert_eq!(std::fs::read_dir(&d).unwrap().count(), 1, "temp files left behind");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn readable_and_writable_sets_are_independent() {
        let d = scratch("sets");
        let f = d.join("a.pdf");
        std::fs::write(&f, b"%PDF-1").unwrap();
        let r = ReadablePaths::default();
        let w = WritablePaths::default();
        r.0.allow(&f);
        assert!(r.0.is_allowed(&f));
        assert!(!w.0.is_allowed(&f));
        assert!(!r.0.is_allowed(&d.join("b.pdf")));
        assert_eq!(read_pdf_file(&f).unwrap(), b"%PDF-1");
        assert_eq!(read_pdf_file(&d.join("gone.pdf")).unwrap_err(), "pdf.not_found");
        std::fs::remove_dir_all(&d).unwrap();
    }
}
