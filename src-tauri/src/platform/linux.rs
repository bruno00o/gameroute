use std::collections::HashSet;
use sysinfo::System;

pub const SYSTEM_PROCESSES: &[&str] = &[
    "systemd",
    "kthreadd",
    "ksoftirqd",
    "rcu_sched",
    "migration",
    "watchdog",
    "init",
    "dbus-daemon",
    "NetworkManager",
    "pulseaudio",
    "pipewire",
    "Xorg",
    "Xwayland",
    "gnome-shell",
    "kwin_wayland",
    "gameroute",
    "GameRoute",
];

pub fn derive_group_key(name: &str, exe_path: Option<&str>) -> String {
    let _ = exe_path;
    name.to_string()
}

pub fn display_name_for_group(_group_key: &str, fallback_name: &str) -> String {
    fallback_name.to_string()
}

/// No-op on Linux — BFS parent->child is sufficient.
/// Extensible later (e.g. cgroups).
pub fn extend_related_pids(_sys: &System, _root_pid: u32, _result: &mut HashSet<u32>) {}
