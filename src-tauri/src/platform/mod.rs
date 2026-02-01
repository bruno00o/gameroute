use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System, UpdateKind};

use crate::models::{DetectedGame, MonitoredGameEntry, RunningApp, RunningProcess};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as os;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows as os;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
use linux as os;

fn system() -> &'static Mutex<System> {
    static SYSTEM: OnceLock<Mutex<System>> = OnceLock::new();
    SYSTEM.get_or_init(|| {
        Mutex::new(System::new_with_specifics(
            RefreshKind::nothing()
                .with_processes(ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet)),
        ))
    })
}

pub fn enumerate_running_processes() -> Vec<(u32, String)> {
    let mut sys = system().lock().unwrap_or_else(|e| e.into_inner());
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );

    sys.processes()
        .iter()
        .map(|(pid, process)| (pid.as_u32(), process.name().to_string_lossy().to_string()))
        .collect()
}

pub fn detect_games_from_processes(
    processes: &[(u32, String)],
    monitored_games: &[MonitoredGameEntry],
) -> Vec<DetectedGame> {
    let mut detected = Vec::new();

    for (pid, process_name) in processes {
        let name_lower = process_name.to_lowercase();

        for entry in monitored_games {
            let exe_lower = entry.executable_name.to_lowercase();
            let matched = name_lower == exe_lower
                || (!name_lower.ends_with(".exe") && format!("{}.exe", name_lower) == exe_lower)
                || (name_lower.ends_with(".exe")
                    && name_lower[..name_lower.len() - 4] == exe_lower)
                || (exe_lower.ends_with(".app")
                    && name_lower == exe_lower[..exe_lower.len() - 4]);

            if matched {
                detected.push(DetectedGame::new(
                    entry.name.clone(),
                    *pid,
                    entry.icon_url.clone(),
                ));
                break;
            }
        }
    }

    detected
}

pub fn is_process_running(pid: u32) -> bool {
    let mut sys = system().lock().unwrap_or_else(|e| e.into_inner());
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
        true,
        ProcessRefreshKind::nothing(),
    );

    sys.process(Pid::from_u32(pid)).is_some()
}

pub fn list_running_processes_filtered() -> Vec<RunningProcess> {
    let processes = enumerate_running_processes();
    let mut filtered: Vec<RunningProcess> = processes
        .into_iter()
        .filter(|(pid, name)| {
            if *pid < 100 {
                return false;
            }

            let name_lower = name.to_lowercase();
            for sys_proc in os::SYSTEM_PROCESSES {
                if name_lower == sys_proc.to_lowercase() {
                    return false;
                }
            }

            true
        })
        .map(|(pid, name)| RunningProcess {
            pid,
            name,
            path: None,
        })
        .collect();

    filtered.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    filtered
}

struct GroupEntry {
    display_name: String,
    pid: u32,
    process_count: u32,
    exe_path: Option<String>,
    /// Length of the exe path for the chosen PID (shorter = main exe).
    exe_path_len: usize,
}

pub fn list_running_apps_grouped() -> Vec<RunningApp> {
    let mut sys = system().lock().unwrap_or_else(|e| e.into_inner());
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );

    let mut groups: HashMap<String, GroupEntry> = HashMap::new();

    for (pid, process) in sys.processes() {
        let pid_u32 = pid.as_u32();
        if pid_u32 < 100 {
            continue;
        }

        let name = process.name().to_string_lossy().to_string();
        let name_lower = name.to_lowercase();

        let is_system = os::SYSTEM_PROCESSES
            .iter()
            .any(|sp| name_lower == sp.to_lowercase());
        if is_system {
            continue;
        }

        let exe_path = process.exe().map(|p| p.to_string_lossy().to_string());

        let group_key = os::derive_group_key(&name, exe_path.as_deref());

        let path_len = exe_path.as_ref().map(|p| p.len()).unwrap_or(usize::MAX);

        match groups.get_mut(&group_key) {
            Some(entry) => {
                entry.process_count += 1;
                // Pick the PID with the shortest exe path (main exe vs helpers)
                if path_len < entry.exe_path_len {
                    entry.pid = pid_u32;
                    entry.exe_path = exe_path;
                    entry.exe_path_len = path_len;
                    entry.display_name = os::display_name_for_group(&group_key, &name);
                }
            }
            None => {
                let display = os::display_name_for_group(&group_key, &name);
                groups.insert(
                    group_key,
                    GroupEntry {
                        display_name: display,
                        pid: pid_u32,
                        process_count: 1,
                        exe_path: exe_path.clone(),
                        exe_path_len: path_len,
                    },
                );
            }
        }
    }

    let mut apps: Vec<RunningApp> = groups
        .into_values()
        .map(|entry| RunningApp {
            name: entry.display_name,
            pid: entry.pid,
            process_count: entry.process_count,
            path: entry.exe_path,
        })
        .collect();

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

/// BFS from root_pid collecting all descendant PIDs via parent->child links.
fn bfs_children(sys: &System, root_pid: u32, result: &mut HashSet<u32>) {
    let mut children_map: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, process) in sys.processes() {
        if let Some(parent) = process.parent() {
            children_map
                .entry(parent.as_u32())
                .or_default()
                .push(pid.as_u32());
        }
    }

    let mut queue = vec![root_pid];
    while let Some(pid) = queue.pop() {
        if let Some(children) = children_map.get(&pid) {
            for &child in children {
                if result.insert(child) {
                    queue.push(child);
                }
            }
        }
    }
}

/// Return the given PID plus all related PIDs.
///
/// 1. Platform-specific strategy (app bundle matching on macOS, no-op elsewhere)
/// 2. Shared BFS parent->child traversal (all platforms)
pub fn get_related_pids(root_pid: u32) -> HashSet<u32> {
    let mut sys = system().lock().unwrap_or_else(|e| e.into_inner());
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );

    let mut result = HashSet::new();
    result.insert(root_pid);

    // 1. Platform-specific strategy
    os::extend_related_pids(&sys, root_pid, &mut result);

    // 2. Shared: BFS parent->child (all platforms)
    bfs_children(&sys, root_pid, &mut result);

    log::debug!(
        "Related PIDs for PID {}: {} total PIDs",
        root_pid,
        result.len()
    );
    result
}

pub fn get_process_name(pid: u32) -> Option<String> {
    let mut sys = system().lock().unwrap_or_else(|e| e.into_inner());
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );

    sys.process(Pid::from_u32(pid))
        .map(|p| p.name().to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enumerate_returns_current_process() {
        let current_pid = std::process::id();
        let processes = enumerate_running_processes();
        assert!(
            processes.iter().any(|(pid, _)| *pid == current_pid),
            "Current process (PID {}) should be in the list",
            current_pid
        );
    }

    #[test]
    fn test_is_process_running_self() {
        let current_pid = std::process::id();
        assert!(
            is_process_running(current_pid),
            "Current process should be reported as running"
        );
    }

    #[test]
    fn test_is_process_running_invalid_pid() {
        assert!(
            !is_process_running(u32::MAX),
            "Invalid PID should not be running"
        );
    }

    #[test]
    fn test_list_filtered_excludes_low_pids() {
        let filtered = list_running_processes_filtered();
        assert!(
            filtered.iter().all(|p| p.pid >= 100),
            "All filtered processes should have PID >= 100"
        );
    }

    #[test]
    fn test_get_process_name_self() {
        let current_pid = std::process::id();
        let name = get_process_name(current_pid);
        assert!(name.is_some(), "Should be able to get current process name");
    }

    #[test]
    fn test_list_running_apps_grouped_returns_results() {
        let apps = list_running_apps_grouped();
        assert!(!apps.is_empty(), "Should return at least one running app");
        assert!(
            apps.iter().all(|a| a.pid >= 100),
            "All app PIDs should be >= 100"
        );
        assert!(
            apps.iter().all(|a| a.process_count >= 1),
            "All apps should have process_count >= 1"
        );
    }

    #[test]
    fn test_get_related_pids_includes_root() {
        let current_pid = std::process::id();
        let pids = get_related_pids(current_pid);
        assert!(
            pids.contains(&current_pid),
            "Related PIDs should include the root PID"
        );
    }
}
