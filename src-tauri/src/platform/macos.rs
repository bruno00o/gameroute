use std::collections::HashSet;
use sysinfo::{Pid, System};

pub const SYSTEM_PROCESSES: &[&str] = &[
    "kernel_task",
    "launchd",
    "syslogd",
    "configd",
    "mds",
    "mds_stores",
    "WindowServer",
    "loginwindow",
    "Finder",
    "Dock",
    "SystemUIServer",
    "coreaudiod",
    "bluetoothd",
    "fseventsd",
    "distnoted",
    "cfprefsd",
    "gameroute",
    "GameRoute",
];

/// Extract the `.app` bundle path from an exe path.
/// e.g. `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` -> `/Applications/Google Chrome.app`
pub fn extract_app_bundle_path(exe_path: &str) -> Option<&str> {
    if let Some(idx) = exe_path.find(".app/") {
        Some(&exe_path[..idx + 4]) // include ".app"
    } else if exe_path.ends_with(".app") {
        Some(exe_path)
    } else {
        None
    }
}

/// Extract the display name from a `.app` bundle path.
/// e.g. `/Applications/Google Chrome.app` -> `Google Chrome`
pub fn app_name_from_bundle(bundle_path: &str) -> String {
    let file_name = bundle_path.rsplit('/').next().unwrap_or(bundle_path);
    file_name
        .strip_suffix(".app")
        .unwrap_or(file_name)
        .to_string()
}

pub fn derive_group_key(name: &str, exe_path: Option<&str>) -> String {
    if let Some(path) = exe_path {
        if let Some(bundle) = extract_app_bundle_path(path) {
            return bundle.to_string();
        }
    }
    name.to_string()
}

pub fn display_name_for_group(group_key: &str, fallback_name: &str) -> String {
    if group_key.ends_with(".app") {
        return app_name_from_bundle(group_key);
    }
    fallback_name.to_string()
}

/// Collect all PIDs whose exe lives under the same `.app` bundle as the root PID.
/// This catches Chromium/Electron helpers spawned via XPC (parented by launchd).
pub fn extend_related_pids(sys: &System, root_pid: u32, result: &mut HashSet<u32>) {
    let bundle_path = sys
        .process(Pid::from_u32(root_pid))
        .and_then(|p| p.exe())
        .and_then(|exe| extract_app_bundle_path(&exe.to_string_lossy()).map(String::from));

    if let Some(bundle) = bundle_path {
        for (pid, process) in sys.processes() {
            if let Some(exe) = process.exe() {
                if exe.to_string_lossy().starts_with(&bundle) {
                    result.insert(pid.as_u32());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_app_bundle_path() {
        let path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
        assert_eq!(
            extract_app_bundle_path(path),
            Some("/Applications/Google Chrome.app")
        );
    }

    #[test]
    fn test_extract_app_bundle_path_no_app() {
        let path = "/usr/bin/python3";
        assert_eq!(extract_app_bundle_path(path), None);
    }

    #[test]
    fn test_app_name_from_bundle() {
        assert_eq!(
            app_name_from_bundle("/Applications/Google Chrome.app"),
            "Google Chrome"
        );
        assert_eq!(app_name_from_bundle("/Applications/Discord.app"), "Discord");
    }
}
