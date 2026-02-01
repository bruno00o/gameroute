use std::collections::HashSet;
use sysinfo::System;

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

/// No-op on Windows — BFS parent->child is sufficient.
/// Extensible later (e.g. Job Objects).
pub fn extend_related_pids(_sys: &System, _root_pid: u32, _result: &mut HashSet<u32>) {}
