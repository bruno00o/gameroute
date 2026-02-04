use std::path::Path;

/// Resolve the actual executable name from a path.
///
/// On macOS, if the path points to a `.app` bundle, look inside
/// `Contents/MacOS/` for the real binary so that it matches what
/// `sysinfo` reports as the process name.
pub fn resolve_executable_name(path: &str) -> String {
    let p = Path::new(path);

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

/// Known non-game executable prefixes/names to filter out when scanning a
/// game's install directory for the main executable.
const NON_GAME_EXECUTABLES: &[&str] = &[
    "unitycrashhandler",
    "crashreporter",
    "crashhandler",
    "crash_reporter",
    "vcredist",
    "dxsetup",
    "dxwebsetup",
    "dotnet",
    "unins000",
    "unins001",
    "setup",
    "installer",
    "ue4prereqsetup",
    "ue4prerequisites",
    "easyanticheat",
    "eac_launcher",
    "battleye",
    "beservice",
    "belauncher",
    "steamapi",
    "steam_api",
];

/// Scan a directory for executable files and return the best candidate name.
///
/// Looks at top-level files in `dir` for platform-appropriate executables,
/// filters out known non-game binaries (crash handlers, redistributables, etc.),
/// and picks the best match. If `hint` is provided, prefers executables whose
/// name is closest to it (case-insensitive substring match).
///
/// Falls back to `resolve_executable_name(dir)` if no candidates are found.
pub fn scan_executables_in_dir(dir: &Path, hint: &str) -> String {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return resolve_executable_name(&dir.to_string_lossy()),
    };

    let mut candidates: Vec<String> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let file_name = match path.file_name() {
            Some(n) => n.to_string_lossy().to_string(),
            None => continue,
        };

        if !is_executable_file(&file_name, &path) {
            continue;
        }

        let lower = file_name.to_lowercase();

        // Filter out known non-game executables
        let is_non_game = NON_GAME_EXECUTABLES
            .iter()
            .any(|prefix| lower.starts_with(prefix));
        if is_non_game {
            continue;
        }

        candidates.push(file_name);
    }

    if candidates.is_empty() {
        return resolve_executable_name(&dir.to_string_lossy());
    }

    if candidates.len() == 1 {
        return candidates.into_iter().next().unwrap();
    }

    // Prefer the candidate whose name is closest to the hint
    let hint_lower = hint.to_lowercase().replace(' ', "");
    if let Some(best) = candidates.iter().find(|c| {
        let stem = c
            .strip_suffix(".exe")
            .or_else(|| c.strip_suffix(".app"))
            .unwrap_or(c)
            .to_lowercase()
            .replace(' ', "");
        stem == hint_lower || hint_lower.contains(&stem) || stem.contains(&hint_lower)
    }) {
        return best.clone();
    }

    // No match on hint, return the first candidate
    candidates.into_iter().next().unwrap()
}

/// Check if a file is a platform-appropriate executable.
fn is_executable_file(file_name: &str, _path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        file_name.to_lowercase().ends_with(".exe")
    }

    #[cfg(target_os = "macos")]
    {
        if file_name.ends_with(".app") {
            return true;
        }
        // Check if file has no extension (likely a binary)
        !file_name.contains('.') || {
            use std::os::unix::fs::PermissionsExt;
            _path
                .metadata()
                .map(|m| m.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Check for no extension or executable permission
        !file_name.contains('.') || {
            use std::os::unix::fs::PermissionsExt;
            _path
                .metadata()
                .map(|m| m.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_scan_empty_dir_falls_back() {
        let dir = TempDir::new().unwrap();
        let result = scan_executables_in_dir(dir.path(), "mygame");
        // Should fall back to directory name
        assert!(!result.is_empty());
    }

    #[test]
    fn test_scan_filters_non_game_executables() {
        let dir = TempDir::new().unwrap();

        #[cfg(target_os = "windows")]
        {
            fs::write(dir.path().join("mygame.exe"), "").unwrap();
            fs::write(dir.path().join("UnityCrashHandler64.exe"), "").unwrap();
            fs::write(dir.path().join("unins000.exe"), "").unwrap();
        }

        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::fs::PermissionsExt;
            let game_path = dir.path().join("mygame");
            fs::write(&game_path, "").unwrap();
            fs::set_permissions(&game_path, fs::Permissions::from_mode(0o755)).unwrap();
        }

        let result = scan_executables_in_dir(dir.path(), "mygame");
        let lower = result.to_lowercase();
        assert!(
            lower.contains("mygame"),
            "Expected 'mygame' in result, got: {}",
            result
        );
    }

    #[test]
    fn test_scan_prefers_hint_match() {
        let dir = TempDir::new().unwrap();

        #[cfg(target_os = "windows")]
        {
            fs::write(dir.path().join("launcher.exe"), "").unwrap();
            fs::write(dir.path().join("coolshooter.exe"), "").unwrap();
            fs::write(dir.path().join("server.exe"), "").unwrap();
        }

        #[cfg(not(target_os = "windows"))]
        {
            use std::os::unix::fs::PermissionsExt;
            for name in &["launcher", "coolshooter", "server"] {
                let p = dir.path().join(name);
                fs::write(&p, "").unwrap();
                fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
            }
        }

        let result = scan_executables_in_dir(dir.path(), "Cool Shooter");
        let lower = result.to_lowercase();
        assert!(
            lower.contains("coolshooter"),
            "Expected 'coolshooter' in result, got: {}",
            result
        );
    }
}
