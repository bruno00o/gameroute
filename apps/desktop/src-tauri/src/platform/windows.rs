use std::collections::HashSet;
use sysinfo::{Pid, System};

pub const SYSTEM_PROCESSES: &[&str] = &[
    "svchost.exe",
    "csrss.exe",
    "smss.exe",
    "wininit.exe",
    "services.exe",
    "lsass.exe",
    "winlogon.exe",
    "dwm.exe",
    "explorer.exe",
    "System",
    "Registry",
    "Idle",
    "RuntimeBroker.exe",
    "SearchIndexer.exe",
    "SecurityHealthService.exe",
    "MsMpEng.exe",
    "WmiPrvSE.exe",
    "spoolsv.exe",
    "sihost.exe",
    "taskhostw.exe",
    "ctfmon.exe",
    "conhost.exe",
    "fontdrvhost.exe",
    "dllhost.exe",
    "SearchHost.exe",
    "StartMenuExperienceHost.exe",
    "TextInputHost.exe",
    "ShellExperienceHost.exe",
    "ApplicationFrameHost.exe",
    "SystemSettings.exe",
    "backgroundTaskHost.exe",
    "audiodg.exe",
    "SearchProtocolHost.exe",
    "SearchFilterHost.exe",
    "gameroute.exe",
    "GameRoute.exe",
];

pub fn derive_group_key(name: &str, exe_path: Option<&str>) -> String {
    let _ = exe_path;
    name.to_lowercase()
}

pub fn display_name_for_group(_group_key: &str, fallback_name: &str) -> String {
    fallback_name.to_string()
}

/// Find all processes whose executable lives in the same directory as the root process.
/// This catches multi-process apps (browsers, launchers) that spawn siblings in the same install folder.
pub fn extend_related_pids(sys: &System, root_pid: u32, result: &mut HashSet<u32>) {
    let root_exe_dir = sys
        .process(Pid::from_u32(root_pid))
        .and_then(|p| p.exe())
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()));

    let Some(root_dir) = root_exe_dir else {
        return;
    };

    for (pid, process) in sys.processes() {
        if let Some(exe) = process.exe() {
            if let Some(dir) = exe.parent() {
                if dir == root_dir {
                    result.insert(pid.as_u32());
                }
            }
        }
    }
}
