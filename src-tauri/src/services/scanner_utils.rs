/// Resolve the actual executable name from a path.
///
/// On macOS, if the path points to a `.app` bundle, look inside
/// `Contents/MacOS/` for the real binary so that it matches what
/// `sysinfo` reports as the process name.
pub fn resolve_executable_name(path: &str) -> String {
    let p = std::path::Path::new(path);

    #[cfg(target_os = "macos")]
    if path.ends_with(".app") {
        let macos_dir = p.join("Contents/MacOS");
        if let Ok(entries) = std::fs::read_dir(&macos_dir) {
            for entry in entries.flatten() {
                if entry.path().is_file() {
                    if let Some(name) = entry.path().file_name() {
                        let name = name.to_string_lossy().to_string();
                        log::info!(
                            "Resolved .app bundle executable: {} -> {}",
                            path,
                            name
                        );
                        return name;
                    }
                }
            }
        }
    }

    p.file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}
