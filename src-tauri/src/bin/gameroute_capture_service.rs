//! GameRoute Capture Service - Windows service for privileged UDP packet capture.
//!
//! This service runs with SYSTEM privileges to capture UDP packets using pktmon.
//! It communicates with the Tauri app via a named pipe.
//!
//! ## Anti-cheat bypass design
//!
//! Anti-cheat software (e.g. EAAntiCheat) blocks `pktmon start` after the game loads,
//! but ETW sessions started BEFORE the anti-cheat continue working. This service starts
//! pktmon ONCE at boot (before any game/anti-cheat). Per capture request, it attaches an
//! ETW real-time consumer to pktmon's live session, collects matching UDP packets for N
//! seconds, then returns the endpoints.
//!
//! Usage:
//!   Install:   sc create GameRouteCaptureService binPath= "path\to\gameroute-capture-service.exe"
//!   Start:     sc start GameRouteCaptureService
//!   Stop:      sc stop GameRouteCaptureService
//!   Uninstall: sc delete GameRouteCaptureService

#![allow(dead_code, unused_imports, unused_variables, unused_mut)]

mod service {
    use std::collections::{HashMap, HashSet};
    use std::ffi::OsString;
    use std::io::{Read, Write};
    use std::net::IpAddr;
    use std::os::windows::process::CommandExt;
    use std::process::{Child, Command};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use windows_service::service::{
        ServiceAccess, ServiceControl, ServiceControlAccept, ServiceErrorControl, ServiceExitCode,
        ServiceInfo, ServiceStartType, ServiceState, ServiceStatus, ServiceType,
    };
    use windows_service::service_control_handler::{self, ServiceControlHandlerResult};
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
    use windows_service::{define_windows_service, service_dispatcher};

    use app_lib::models::capture_protocol::{
        CaptureRequest, CaptureResponse, CaptureStatus, CapturedEndpoint,
        ServiceRequest, ServiceResponse,
        TracerouteRequest, TracerouteResponse, TracerouteStatus, ServiceHop,
        PROTOCOL_VERSION,
    };

    use trippy_core::{Builder, PortDirection, PrivilegeMode, Protocol};

    macro_rules! slog {
        ($($arg:tt)*) => {
            eprintln!(
                "[{}] {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
                format_args!($($arg)*)
            )
        };
    }

    const LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

    const SERVICE_NAME: &str = "GameRouteCaptureService";
    const SERVICE_DISPLAY_NAME: &str = "GameRoute Capture Service";
    const SERVICE_DESCRIPTION: &str =
        "Captures UDP network traffic for game connection analysis in GameRoute.";
    const PIPE_NAME: &str = r"\\.\pipe\GameRouteCaptureService";
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    /// ETW session name used by pktmon in real-time mode.
    const PKTMON_SESSION_NAME: &str = "PktMon";

    /// Ethernet (14) + IPv6 (40) + UDP (8) = 62 bytes: enough for the addresses and ports.
    const PKTMON_PKT_SIZE: u32 = 64;

    /// pktmon's real-time mode still writes PktMon.etl next to the live session (512 MB by
    /// default, then only "buffers lost"). Real-time delivery does not depend on that file.
    const PKTMON_FILE_SIZE_MB: u32 = 1;

    /// Timeout for a single traceroute operation (seconds).
    const TRACEROUTE_TIMEOUT_SECS: u64 = 30;

    // Define the Windows service entry point using the macro
    define_windows_service!(ffi_service_main, service_main);

    fn service_main(_arguments: Vec<OsString>) {
        if let Err(e) = run_service() {
            slog!("Service error: {}", e);
        }
    }

    // ── Service Entry Point ──────────────────────────────────────────────────

    pub fn run() -> Result<(), Box<dyn std::error::Error>> {
        let args: Vec<String> = std::env::args().collect();
        if args.len() > 1 {
            match args[1].as_str() {
                "install" => return install_service(),
                "uninstall" => return uninstall_service(),
                "run" => return run_as_console(),
                _ => {
                    slog!("Usage: gameroute-capture-service [install|uninstall|run]");
                    slog!("  install   - Install as Windows service");
                    slog!("  uninstall - Remove Windows service");
                    slog!("  run       - Run in console mode (for debugging)");
                    return Ok(());
                }
            }
        }

        service_dispatcher::start(SERVICE_NAME, ffi_service_main)?;
        Ok(())
    }

    fn install_service() -> Result<(), Box<dyn std::error::Error>> {
        let manager =
            ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CREATE_SERVICE)?;

        let exe_path = std::env::current_exe()?;

        let service_info = ServiceInfo {
            name: OsString::from(SERVICE_NAME),
            display_name: OsString::from(SERVICE_DISPLAY_NAME),
            service_type: ServiceType::OWN_PROCESS,
            start_type: ServiceStartType::AutoStart,
            error_control: ServiceErrorControl::Normal,
            executable_path: exe_path,
            launch_arguments: vec![],
            dependencies: vec![],
            account_name: None,
            account_password: None,
        };

        let service = manager.create_service(&service_info, ServiceAccess::CHANGE_CONFIG)?;
        service.set_description(SERVICE_DESCRIPTION)?;

        println!("Service '{}' installed successfully.", SERVICE_NAME);
        println!("Start with: sc start {}", SERVICE_NAME);
        Ok(())
    }

    fn uninstall_service() -> Result<(), Box<dyn std::error::Error>> {
        let manager =
            ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;

        let service = manager.open_service(SERVICE_NAME, ServiceAccess::DELETE)?;
        service.delete()?;

        println!("Service '{}' uninstalled successfully.", SERVICE_NAME);
        Ok(())
    }

    fn run_as_console() -> Result<(), Box<dyn std::error::Error>> {
        println!("Running in console mode. Press Ctrl+C to stop.");

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_clone = stop_flag.clone();

        ctrlc::set_handler(move || {
            println!("\nShutting down...");
            stop_flag_clone.store(true, Ordering::SeqCst);
            wake_pipe_server();
        })?;

        run_pipe_server(stop_flag);

        println!("Service stopped.");
        Ok(())
    }

    fn wake_pipe_server() {
        let _ = std::fs::OpenOptions::new().read(true).write(true).open(PIPE_NAME);
    }

    fn redirect_stderr_to_log_file() {
        use std::os::windows::io::IntoRawHandle;
        use windows_sys::Win32::System::Console::{SetStdHandle, STD_ERROR_HANDLE};

        let program_data =
            std::env::var_os("ProgramData").unwrap_or_else(|| r"C:\ProgramData".into());
        let dir = std::path::Path::new(&program_data).join("GameRoute").join("logs");
        if std::fs::create_dir_all(&dir).is_err() {
            return;
        }
        let path = dir.join("capture-service.log");
        if std::fs::metadata(&path).is_ok_and(|m| m.len() > LOG_MAX_BYTES) {
            let _ = std::fs::rename(&path, dir.join("capture-service.old.log"));
        }
        if let Ok(file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            unsafe { SetStdHandle(STD_ERROR_HANDLE, file.into_raw_handle()) };
        }
    }

    fn run_service() -> Result<(), Box<dyn std::error::Error>> {
        redirect_stderr_to_log_file();
        slog!("Service starting (version {})", env!("CARGO_PKG_VERSION"));

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_clone = stop_flag.clone();

        let event_handler = move |control_event| -> ServiceControlHandlerResult {
            match control_event {
                ServiceControl::Stop | ServiceControl::Shutdown => {
                    slog!("Stop requested");
                    stop_flag_clone.store(true, Ordering::SeqCst);
                    wake_pipe_server();
                    ServiceControlHandlerResult::NoError
                }
                ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
                _ => ServiceControlHandlerResult::NotImplemented,
            }
        };

        let status_handle = service_control_handler::register(SERVICE_NAME, event_handler)?;

        status_handle.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::Running,
            controls_accepted: ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN,
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::default(),
            process_id: None,
        })?;

        run_pipe_server(stop_flag);

        status_handle.set_service_status(ServiceStatus {
            service_type: ServiceType::OWN_PROCESS,
            current_state: ServiceState::Stopped,
            controls_accepted: ServiceControlAccept::empty(),
            exit_code: ServiceExitCode::Win32(0),
            checkpoint: 0,
            wait_hint: Duration::default(),
            process_id: None,
        })?;

        Ok(())
    }

    // ── Persistent pktmon lifecycle ──────────────────────────────────────────

    /// Start pktmon in real-time capture mode. This must happen BEFORE any
    /// anti-cheat loads, so the ETW session survives anti-cheat blocks.
    fn start_persistent_pktmon() -> Option<Child> {
        // Clean up any lingering session
        let _ = Command::new("pktmon")
            .args(["stop"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let _ = Command::new("pktmon")
            .args(["filter", "remove"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        // Add a broad UDP filter — port filtering is done in Rust
        let filter_result = Command::new("pktmon")
            .args(["filter", "add", "-t", "UDP"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        match &filter_result {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                slog!("pktmon filter add UDP: {}", stdout.trim());
            }
            Err(e) => {
                slog!("pktmon filter add failed: {}", e);
                return None;
            }
        }

        let child = spawn_realtime_pktmon(Some(PKTMON_FILE_SIZE_MB)).or_else(|| {
            slog!("pktmon refused --file-size, starting without it");
            let _ = Command::new("pktmon")
                .args(["stop"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            spawn_realtime_pktmon(None)
        })?;

        if let Ok(status) = Command::new("pktmon")
            .args(["status"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let stdout = String::from_utf8_lossy(&status.stdout);
            slog!("pktmon status: {}", stdout.trim());
        }

        Some(child)
    }

    fn pktmon_start_args(file_size_mb: Option<u32>) -> Vec<String> {
        let mut args: Vec<String> = ["start", "--capture", "--log-mode", "real-time", "--pkt-size"]
            .iter()
            .map(|a| a.to_string())
            .collect();
        args.push(PKTMON_PKT_SIZE.to_string());
        if let Some(size) = file_size_mb {
            args.push("--file-size".to_string());
            args.push(size.to_string());
        }
        args
    }

    /// pktmon stays alive in real-time mode; an early exit means it rejected the arguments.
    /// Success is confirmed by the ETW session showing up in real-time mode.
    fn spawn_realtime_pktmon(file_size_mb: Option<u32>) -> Option<Child> {
        let args = pktmon_start_args(file_size_mb);
        let mut child = match Command::new("pktmon")
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                slog!("Failed to spawn pktmon: {}", e);
                return None;
            }
        };

        let started = std::time::Instant::now();
        let mut query_error = 0;
        while started.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(250));
            match query_session_stats(PKTMON_SESSION_NAME) {
                Ok(stats) if stats.is_real_time() => {
                    slog!(
                        "pktmon started (pid {}, {}): {}",
                        child.id(),
                        args.join(" "),
                        stats.describe()
                    );
                    return Some(child);
                }
                Ok(stats) => slog!("pktmon session is not real-time yet: {}", stats.describe()),
                Err(code) => query_error = code,
            }
            if let Ok(Some(status)) = child.try_wait() {
                slog!("pktmon exited ({}) with: {}", status, args.join(" "));
                return None;
            }
        }

        slog!(
            "pktmon session not confirmed after 3s (query error {}), pid {} still running: {}",
            query_error,
            child.id(),
            args.join(" ")
        );
        Some(child)
    }

    /// Counters of an ETW session, read with `ControlTraceW(EVENT_TRACE_CONTROL_QUERY)`.
    #[derive(Debug, Clone, PartialEq, Eq)]
    struct SessionStats {
        log_file_mode: u32,
        max_file_size_mb: u32,
        buffer_size_kb: u32,
        events_lost: u32,
        buffers_written: u32,
        log_buffers_lost: u32,
        realtime_buffers_lost: u32,
        log_file_name: String,
    }

    impl SessionStats {
        fn from_properties(
            props: &windows_sys::Win32::System::Diagnostics::Etw::EVENT_TRACE_PROPERTIES,
            log_file_name: String,
        ) -> Self {
            Self {
                log_file_mode: props.LogFileMode,
                max_file_size_mb: props.MaximumFileSize,
                buffer_size_kb: props.BufferSize,
                events_lost: props.EventsLost,
                buffers_written: props.BuffersWritten,
                log_buffers_lost: props.LogBuffersLost,
                realtime_buffers_lost: props.RealTimeBuffersLost,
                log_file_name,
            }
        }

        fn is_real_time(&self) -> bool {
            use windows_sys::Win32::System::Diagnostics::Etw::EVENT_TRACE_REAL_TIME_MODE;
            self.log_file_mode & EVENT_TRACE_REAL_TIME_MODE != 0
        }

        fn describe(&self) -> String {
            format!(
                "mode 0x{:x}, file '{}' max {} MB, buffers {} KB, written {}, \
                 events lost {}, file buffers lost {}, real-time buffers lost {}",
                self.log_file_mode,
                self.log_file_name,
                self.max_file_size_mb,
                self.buffer_size_kb,
                self.buffers_written,
                self.events_lost,
                self.log_buffers_lost,
                self.realtime_buffers_lost
            )
        }

        fn losses_since(&self, before: &SessionStats) -> SessionLosses {
            SessionLosses {
                events: self.events_lost.wrapping_sub(before.events_lost),
                realtime_buffers: self
                    .realtime_buffers_lost
                    .wrapping_sub(before.realtime_buffers_lost),
                file_buffers: self.log_buffers_lost.wrapping_sub(before.log_buffers_lost),
            }
        }
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    struct SessionLosses {
        events: u32,
        realtime_buffers: u32,
        file_buffers: u32,
    }

    fn query_session_stats(session_name: &str) -> Result<SessionStats, u32> {
        use windows_sys::Win32::System::Diagnostics::Etw::{
            ControlTraceW, CONTROLTRACE_HANDLE, EVENT_TRACE_CONTROL_QUERY, EVENT_TRACE_PROPERTIES,
        };

        const NAME_CHARS: usize = 1024;

        #[repr(C)]
        struct QueryBuffer {
            props: EVENT_TRACE_PROPERTIES,
            logger_name: [u16; NAME_CHARS],
            log_file_name: [u16; NAME_CHARS],
        }

        let name = encode_wide(session_name);
        // SAFETY: QueryBuffer is plain data; zeroed is a valid initial state, and the offsets
        // tell ETW where the two name buffers live inside the same allocation.
        let mut buffer: Box<QueryBuffer> = Box::new(unsafe { std::mem::zeroed() });
        buffer.props.Wnode.BufferSize = std::mem::size_of::<QueryBuffer>() as u32;
        buffer.props.LoggerNameOffset = std::mem::offset_of!(QueryBuffer, logger_name) as u32;
        buffer.props.LogFileNameOffset = std::mem::offset_of!(QueryBuffer, log_file_name) as u32;

        let rc = unsafe {
            ControlTraceW(
                CONTROLTRACE_HANDLE { Value: 0 },
                name.as_ptr(),
                &mut buffer.props,
                EVENT_TRACE_CONTROL_QUERY,
            )
        };
        if rc != 0 {
            return Err(rc);
        }

        let file_name = wide_until_nul(&buffer.log_file_name);
        Ok(SessionStats::from_properties(&buffer.props, file_name))
    }

    fn wide_until_nul(wide: &[u16]) -> String {
        let len = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
        String::from_utf16_lossy(&wide[..len])
    }

    /// Stop the persistent pktmon session and clean up.
    fn stop_persistent_pktmon(child: &mut Option<Child>) {
        let _ = Command::new("pktmon")
            .args(["stop"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let _ = Command::new("pktmon")
            .args(["filter", "remove"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        if let Some(ref mut c) = child {
            let _ = c.kill();
            let _ = c.wait();
        }

        slog!("pktmon stopped and cleaned up");
    }

    // ── Named Pipe Server using Win32 API with restricted ACL ──────────

    fn run_pipe_server(stop_flag: Arc<AtomicBool>) {
        use std::os::windows::io::FromRawHandle;
        use windows_sys::Win32::Foundation::{
            CloseHandle, GetLastError, LocalFree, ERROR_PIPE_CONNECTED, INVALID_HANDLE_VALUE,
        };
        use windows_sys::Win32::Security::Authorization::{
            ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
        };
        use windows_sys::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
        use windows_sys::Win32::System::Pipes::{
            ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS,
            PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
        };

        const PIPE_ACCESS_DUPLEX: u32 = 0x00000003;
        const PIPE_SDDL: &str = "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x12019b;;;BU)";

        let mut pktmon_child = start_persistent_pktmon();
        if pktmon_child.is_none() {
            slog!("WARNING: pktmon failed to start, captures will fail");
        }

        let pipe_name_wide = encode_wide(PIPE_NAME);
        let sddl_wide = encode_wide(PIPE_SDDL);

        let mut security_descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
        let sd_ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl_wide.as_ptr(),
                SDDL_REVISION_1,
                &mut security_descriptor,
                std::ptr::null_mut(),
            )
        };
        if sd_ok == 0 {
            slog!("Failed to build pipe security descriptor: error {}", unsafe {
                GetLastError()
            });
            stop_persistent_pktmon(&mut pktmon_child);
            return;
        }

        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: security_descriptor,
            bInheritHandle: 0,
        };

        slog!("Pipe server listening on {}", PIPE_NAME);

        while !stop_flag.load(Ordering::SeqCst) {
            // Create a new named pipe instance
            let handle = unsafe {
                CreateNamedPipeW(
                    pipe_name_wide.as_ptr(),
                    PIPE_ACCESS_DUPLEX,
                    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                    PIPE_UNLIMITED_INSTANCES,
                    4096,  // output buffer
                    4096,  // input buffer
                    0,     // default timeout
                    &sa,
                )
            };

            if handle == INVALID_HANDLE_VALUE {
                if !stop_flag.load(Ordering::SeqCst) {
                    slog!("CreateNamedPipeW failed: error {}", unsafe { GetLastError() });
                    std::thread::sleep(Duration::from_millis(500));
                }
                continue;
            }

            // Wait for a client to connect (blocking call)
            let connected = unsafe { ConnectNamedPipe(handle, std::ptr::null_mut()) };
            if connected == 0 {
                let err = unsafe { GetLastError() };
                if err != ERROR_PIPE_CONNECTED {
                    unsafe { CloseHandle(handle) };
                    if !stop_flag.load(Ordering::SeqCst) {
                        slog!("ConnectNamedPipe error: {}", err);
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    continue;
                }
            }

            if stop_flag.load(Ordering::SeqCst) {
                unsafe { CloseHandle(handle) };
                break;
            }

            slog!("Client connected");

            // Wrap the pipe handle as a File and spawn a thread to handle it.
            // This allows concurrent requests (traceroutes don't block captures).
            let file = unsafe {
                std::fs::File::from_raw_handle(handle)
            };
            std::thread::spawn(move || {
                let mut file = file;
                if let Err(e) = handle_client_request(&mut file) {
                    slog!("Client request error: {}", e);
                }
                slog!("Client disconnected");
                // File drop closes the handle automatically
            });
        }

        unsafe { LocalFree(security_descriptor) };

        // Stop persistent pktmon on shutdown
        stop_persistent_pktmon(&mut pktmon_child);

        slog!("Pipe server shutting down");
    }

    fn encode_wide(s: &str) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn handle_client_request<S: Read + Write>(
        conn: &mut S,
    ) -> Result<(), Box<dyn std::error::Error>> {
        // Read the length prefix (4 bytes, little-endian)
        let mut len_buf = [0u8; 4];
        let first = match conn.read(&mut len_buf) {
            Ok(0) => return Ok(()),
            result => result?,
        };
        conn.read_exact(&mut len_buf[first..])?;

        let msg_len = u32::from_le_bytes(len_buf) as usize;
        if msg_len > 1024 * 1024 {
            return Err("Message too large".into());
        }

        // Read the JSON payload
        let mut payload = vec![0u8; msg_len];
        conn.read_exact(&mut payload)?;

        // Parse the tagged request and dispatch
        let request: ServiceRequest = serde_json::from_slice(&payload)?;
        let response = match request {
            ServiceRequest::Capture(req) => ServiceResponse::Capture(process_capture_request(req)),
            ServiceRequest::Traceroute(req) => ServiceResponse::Traceroute(process_traceroute_request(req)),
        };

        // Serialize and send the response
        let response_json = serde_json::to_vec(&response)?;
        let response_len = (response_json.len() as u32).to_le_bytes();

        conn.write_all(&response_len)?;
        conn.write_all(&response_json)?;
        conn.flush()?;

        Ok(())
    }

    // ── Packet Capture Logic (ETW consumer) ─────────────────────────────────

    fn process_capture_request(request: CaptureRequest) -> CaptureResponse {
        if request.local_ports.is_empty() {
            return CaptureResponse::error(
                request.session_id,
                CaptureStatus::NoPorts,
                "No ports provided".to_string(),
            );
        }

        let duration_secs = request.duration_secs.min(10);

        match capture_udp_traffic(&request.local_ports, duration_secs) {
            Ok(endpoints) => CaptureResponse::success(request.session_id, endpoints),
            Err(e) => CaptureResponse::error(
                request.session_id,
                CaptureStatus::CaptureFailed,
                e.to_string(),
            ),
        }
    }

    // ── Traceroute Logic (trippy-core) ──────────────────────────────────────

    fn process_traceroute_request(request: TracerouteRequest) -> TracerouteResponse {
        let target_ip: IpAddr = match request.target_ip.parse() {
            Ok(ip) => ip,
            Err(e) => {
                return TracerouteResponse {
                    session_id: request.session_id,
                    status: TracerouteStatus::Failed,
                    hops: vec![],
                    destination_reached: false,
                    error_message: Some(format!("Invalid target IP: {}", e)),
                };
            }
        };

        slog!(
            "Traceroute request: {} via {} port {} (max_hops={})",
            request.target_ip, request.protocol, request.port, request.max_hops
        );

        let is_protocol_aware = request.protocol == "TCP" || request.protocol == "UDP";

        match run_trippy_traceroute(
            target_ip,
            &request.protocol,
            request.port,
            request.max_hops,
        ) {
            Ok((hops, destination_reached)) => {
                // Smart fallback: if TCP/UDP produced no intermediate hops
                // (only timeouts + maybe the destination), retry with ICMP
                // to get useful path information.
                if is_protocol_aware && should_fallback_to_icmp(&hops) {
                    slog!(
                        "Traceroute to {} via {} had no intermediate hops, retrying with ICMP",
                        request.target_ip, request.protocol
                    );
                    match run_trippy_traceroute(target_ip, "ICMP", 0, request.max_hops) {
                        Ok((icmp_hops, icmp_reached)) => {
                            slog!(
                                "ICMP fallback to {} complete: {} hops, reached={}",
                                request.target_ip, icmp_hops.len(), icmp_reached
                            );
                            TracerouteResponse {
                                session_id: request.session_id,
                                status: TracerouteStatus::Success,
                                hops: icmp_hops,
                                destination_reached: icmp_reached,
                                error_message: None,
                            }
                        }
                        Err(_) => {
                            // ICMP fallback failed too, return original result
                            TracerouteResponse {
                                session_id: request.session_id,
                                status: TracerouteStatus::Success,
                                hops,
                                destination_reached,
                                error_message: None,
                            }
                        }
                    }
                } else {
                    slog!(
                        "Traceroute to {} complete: {} hops, reached={}",
                        request.target_ip, hops.len(), destination_reached
                    );
                    TracerouteResponse {
                        session_id: request.session_id,
                        status: TracerouteStatus::Success,
                        hops,
                        destination_reached,
                        error_message: None,
                    }
                }
            }
            Err(e) => {
                // TCP/UDP failed entirely, try ICMP as fallback
                if is_protocol_aware {
                    slog!(
                        "Traceroute to {} via {} failed: {}, retrying with ICMP",
                        request.target_ip, request.protocol, e
                    );
                    match run_trippy_traceroute(target_ip, "ICMP", 0, request.max_hops) {
                        Ok((icmp_hops, icmp_reached)) => {
                            return TracerouteResponse {
                                session_id: request.session_id,
                                status: TracerouteStatus::Success,
                                hops: icmp_hops,
                                destination_reached: icmp_reached,
                                error_message: None,
                            };
                        }
                        Err(icmp_e) => {
                            slog!("ICMP fallback also failed: {}", icmp_e);
                        }
                    }
                }
                TracerouteResponse {
                    session_id: request.session_id,
                    status: TracerouteStatus::Failed,
                    hops: vec![],
                    destination_reached: false,
                    error_message: Some(e),
                }
            }
        }
    }

    /// Check if a TCP/UDP traceroute result is "useless" for path analysis.
    /// Returns true if no intermediate hop responded (only timeouts + maybe destination).
    fn should_fallback_to_icmp(hops: &[ServiceHop]) -> bool {
        if hops.len() <= 1 {
            return true;
        }
        // Count intermediate hops that responded (all except the last)
        let intermediate_responded = hops[..hops.len() - 1]
            .iter()
            .filter(|h| h.ip.is_some())
            .count();
        intermediate_responded == 0
    }

    fn run_trippy_traceroute(
        target_ip: IpAddr,
        protocol: &str,
        port: u16,
        max_hops: u8,
    ) -> Result<(Vec<ServiceHop>, bool), String> {
        let mut builder = Builder::new(target_ip)
            .privilege_mode(PrivilegeMode::Privileged)
            .max_ttl(max_hops)
            .max_rounds(Some(10));

        match protocol {
            "TCP" => {
                builder = builder
                    .protocol(Protocol::Tcp)
                    .port_direction(PortDirection::new_fixed_dest(port));
            }
            "UDP" => {
                builder = builder
                    .protocol(Protocol::Udp)
                    .port_direction(PortDirection::new_fixed_dest(port));
            }
            _ => {
                builder = builder.protocol(Protocol::Icmp);
            }
        }

        let tracer = builder.build().map_err(|e| format!("Failed to build tracer: {}", e))?;

        let tracer_clone = tracer.clone();
        let trace_thread = std::thread::spawn(move || {
            let result = tracer_clone.run();
            if let Err(ref e) = result {
                slog!("Tracer.run() error: {:?}", e);
            }
            result
        });

        // Wait with timeout
        let timeout_dur = Duration::from_secs(TRACEROUTE_TIMEOUT_SECS);
        let start = std::time::Instant::now();

        loop {
            if trace_thread.is_finished() {
                break;
            }
            if start.elapsed() >= timeout_dur {
                // Thread is still running but we've timed out — collect what we have
                slog!("Traceroute timed out after {}s, collecting partial results", TRACEROUTE_TIMEOUT_SECS);
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        // Collect results from snapshot regardless of whether trace completed
        let snapshot = tracer.snapshot();
        let target_str = target_ip.to_string();
        let mut hops = Vec::new();
        let mut destination_reached = false;
        let mut last_responding_index: Option<usize> = None;

        slog!(
            "Snapshot for {}: {} hops in snapshot",
            target_str,
            snapshot.hops().len()
        );
        for (i, hop) in snapshot.hops().iter().enumerate() {
            let addr = hop.addrs().next().map(|a| a.to_string());
            slog!(
                "  hop {} (ttl {}): addr={:?}, sent={}, recv={}, samples={}",
                i + 1,
                hop.ttl(),
                addr,
                hop.total_sent(),
                hop.total_recv(),
                hop.samples().len()
            );
        }

        for hop in snapshot.hops() {
            let ttl = hop.ttl() as u32;
            let ip = hop.addrs().next().map(|a| a.to_string());
            let rtt_probes = ServiceHop::rtt_probes_from_samples(hop.samples(), hop.total_sent());

            let idx = hops.len();
            if let Some(ref ip_str) = ip {
                if *ip_str == target_str {
                    destination_reached = true;
                }
                last_responding_index = Some(idx);
            }

            hops.push(ServiceHop { ttl, ip, rtt_probes });
        }

        // Trim trailing timeout hops after the last responding hop
        if let Some(trim_after) = last_responding_index {
            hops.truncate(trim_after + 1);
        }

        let run_error = match trace_thread.join() {
            Ok(Ok(_)) => None,
            Ok(Err(e)) => Some(format!("trippy run failed: {e}")),
            Err(_) => Some("trippy thread panicked".to_string()),
        };

        match run_error {
            Some(e) if hops.is_empty() => Err(e),
            _ => Ok((hops, destination_reached)),
        }
    }

    /// Shared state passed to the ETW callback via the `UserContext` pointer.
    struct EtwCallbackContext {
        local_ports: HashSet<u16>,
        endpoints: Mutex<HashMap<(u16, String, u16), u32>>,
    }

    /// ETW event callback. Called by ProcessTrace for each event from pktmon's session.
    ///
    /// SAFETY: This is called from the ETW subsystem. The `UserContext` pointer must
    /// point to a valid `EtwCallbackContext` for the lifetime of the ProcessTrace call.
    unsafe extern "system" fn etw_event_callback(
        event_record: *mut windows_sys::Win32::System::Diagnostics::Etw::EVENT_RECORD,
    ) {
        let record = &*event_record;

        if record.UserData.is_null() || record.UserDataLength == 0 {
            return;
        }

        let ctx = &*(record.UserContext as *const EtwCallbackContext);

        let user_data = std::slice::from_raw_parts(
            record.UserData as *const u8,
            record.UserDataLength as usize,
        );

        if let Some(endpoint) = endpoint_from_pktmon_event(user_data, &ctx.local_ports) {
            if let Ok(mut endpoints) = ctx.endpoints.lock() {
                *endpoints.entry(endpoint).or_insert(0) += 1;
            }
        }
    }

    /// pktmon events carry a metadata header before the packet, truncated to --pkt-size.
    /// The Ethernet frame is found by scanning for an EtherType followed by a matching IP
    /// version nibble (08 00 4x for IPv4, 86 dd 6x for IPv6), 12 bytes after the frame start.
    /// Raw IP packets at known offsets are the fallback.
    fn endpoint_from_pktmon_event(
        user_data: &[u8],
        local_ports: &HashSet<u16>,
    ) -> Option<(u16, String, u16)> {
        for i in 12..user_data.len().saturating_sub(2) {
            let version = user_data[i + 2] & 0xF0;
            let is_ipv4 = user_data[i] == 0x08 && user_data[i + 1] == 0x00 && version == 0x40;
            let is_ipv6 = user_data[i] == 0x86 && user_data[i + 1] == 0xDD && version == 0x60;
            if is_ipv4 || is_ipv6 {
                if let Some(found) = try_parse_udp_endpoint(&user_data[i - 12..], local_ports) {
                    return Some(found);
                }
            }
        }

        [48, 34, 20, 14, 0].iter().find_map(|&offset| {
            let first = *user_data.get(offset)? & 0xF0;
            if offset + 20 > user_data.len() || (first != 0x40 && first != 0x60) {
                return None;
            }
            try_parse_ip_endpoint(&user_data[offset..], local_ports)
        })
    }

    /// Lax parsing: pktmon truncates packets, so the IP and UDP length fields are larger
    /// than the captured bytes. Only the addresses and ports are needed.
    fn try_parse_udp_endpoint(
        data: &[u8],
        local_ports: &HashSet<u16>,
    ) -> Option<(u16, String, u16)> {
        let parsed = etherparse::LaxSlicedPacket::from_ethernet(data).ok()?;
        extract_udp_from_parsed(&parsed, local_ports)
    }

    fn try_parse_ip_endpoint(
        data: &[u8],
        local_ports: &HashSet<u16>,
    ) -> Option<(u16, String, u16)> {
        let parsed = etherparse::LaxSlicedPacket::from_ip(data).ok()?;
        extract_udp_from_parsed(&parsed, local_ports)
    }

    fn extract_udp_from_parsed(
        parsed: &etherparse::LaxSlicedPacket,
        local_ports: &HashSet<u16>,
    ) -> Option<(u16, String, u16)> {
        use etherparse::{LaxNetSlice, TransportSlice};

        let (src_ip, dst_ip) = match &parsed.net {
            Some(LaxNetSlice::Ipv4(ipv4)) => {
                let header = ipv4.header();
                (
                    std::net::IpAddr::V4(header.source_addr()),
                    std::net::IpAddr::V4(header.destination_addr()),
                )
            }
            Some(LaxNetSlice::Ipv6(ipv6)) => {
                let header = ipv6.header();
                (
                    std::net::IpAddr::V6(header.source_addr()),
                    std::net::IpAddr::V6(header.destination_addr()),
                )
            }
            _ => return None,
        };

        let (src_port, dst_port) = match &parsed.transport {
            Some(TransportSlice::Udp(udp)) => (udp.source_port(), udp.destination_port()),
            _ => return None,
        };

        if local_ports.contains(&src_port) {
            Some((src_port, dst_ip.to_string(), dst_port))
        } else if local_ports.contains(&dst_port) {
            Some((dst_port, src_ip.to_string(), src_port))
        } else {
            None
        }
    }

    /// Capture UDP traffic by attaching an ETW real-time consumer to pktmon's
    /// live session. The pktmon session must already be running (started at boot).
    fn capture_udp_traffic(
        local_ports: &[u16],
        duration_secs: u32,
    ) -> Result<Vec<CapturedEndpoint>, Box<dyn std::error::Error>> {
        use windows_sys::Win32::Foundation::GetLastError;
        use windows_sys::Win32::System::Diagnostics::Etw::{
            CloseTrace, OpenTraceW, ProcessTrace, EVENT_TRACE_LOGFILEW,
            PROCESS_TRACE_MODE_EVENT_RECORD, PROCESS_TRACE_MODE_REAL_TIME,
        };

        slog!(
            "Capturing UDP on ports {:?} for {}s via ETW",
            local_ports, duration_secs
        );

        let ctx = Arc::new(EtwCallbackContext {
            local_ports: local_ports.iter().copied().collect(),
            endpoints: Mutex::new(HashMap::new()),
        });

        // Build the session name as a wide string
        let mut session_name_wide = encode_wide(PKTMON_SESSION_NAME);

        // SAFETY: Initialize EVENT_TRACE_LOGFILEW for real-time consumption.
        // We set LoggerName to the pktmon session, enable real-time + event record
        // mode, and set our callback function with the shared context.
        let trace_handle = unsafe {
            let mut logfile: EVENT_TRACE_LOGFILEW = std::mem::zeroed();
            logfile.LoggerName = session_name_wide.as_mut_ptr();
            logfile.Anonymous1.ProcessTraceMode =
                PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD;
            logfile.Anonymous2.EventRecordCallback = Some(etw_event_callback);
            logfile.Context = Arc::as_ptr(&ctx) as *mut std::ffi::c_void;

            OpenTraceW(&mut logfile)
        };

        // OpenTraceW returns INVALID_PROCESSTRACE_HANDLE (u64::MAX) on failure
        if trace_handle.Value == u64::MAX {
            let err = unsafe { GetLastError() };
            return Err(format!(
                "OpenTraceW failed (error {}). Is pktmon running in real-time mode?",
                err
            )
            .into());
        }

        // Spawn a thread to run ProcessTrace (it blocks until CloseTrace is called)
        let handle_value = trace_handle.Value;
        let process_thread = std::thread::spawn(move || {
            use windows_sys::Win32::System::Diagnostics::Etw::{
                ProcessTrace, PROCESSTRACE_HANDLE,
            };
            let handle = PROCESSTRACE_HANDLE {
                Value: handle_value,
            };
            // SAFETY: ProcessTrace blocks, consuming events via our callback,
            // until CloseTrace is called from the main thread.
            unsafe {
                ProcessTrace(&handle, 1, std::ptr::null(), std::ptr::null())
            }
        });

        // Collect events for the requested duration
        std::thread::sleep(Duration::from_secs(duration_secs as u64));

        // Stop consuming events (unblocks ProcessTrace on the other thread)
        unsafe {
            CloseTrace(trace_handle);
        }

        // Wait for the ProcessTrace thread to finish
        let _ = process_thread.join();

        // Extract endpoints from shared state
        let endpoints_map = ctx
            .endpoints
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?;

        let endpoints: Vec<CapturedEndpoint> = endpoints_map
            .iter()
            .map(
                |((local_port, remote_ip, remote_port), &packet_count)| CapturedEndpoint {
                    local_port: *local_port,
                    remote_ip: remote_ip.clone(),
                    remote_port: *remote_port,
                    packet_count,
                },
            )
            .collect();

        slog!("ETW capture complete: {} endpoints found", endpoints.len());

        Ok(endpoints)
    }

    #[cfg(test)]
    mod tests {
        use super::handle_client_request;
        use std::io::{Cursor, Read, Write};

        struct Conn {
            input: Cursor<Vec<u8>>,
            output: Vec<u8>,
        }

        impl Read for Conn {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                self.input.read(buf)
            }
        }

        impl Write for Conn {
            fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
                self.output.write(buf)
            }

            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }

        fn conn(input: &[u8]) -> Conn {
            Conn { input: Cursor::new(input.to_vec()), output: Vec::new() }
        }

        #[test]
        fn a_status_check_without_a_request_is_not_an_error() {
            let mut c = conn(&[]);
            assert!(handle_client_request(&mut c).is_ok());
            assert!(c.output.is_empty());
        }

        #[test]
        fn a_truncated_request_is_still_an_error() {
            assert!(handle_client_request(&mut conn(&[8, 0])).is_err());
            assert!(handle_client_request(&mut conn(&[8, 0, 0, 0, b'{'])).is_err());
        }
    }

    #[cfg(test)]
    mod pktmon_tests {
        use super::*;
        use etherparse::{PacketBuilder, VlanId};

        const LOCAL: [u8; 4] = [192, 168, 1, 10];
        const SERVER: [u8; 4] = [203, 0, 113, 5];
        const LOCAL6: [u8; 16] = [0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x0a];
        const SERVER6: [u8; 16] = [0x20, 0x01, 0x0d, 0xb8, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x05];

        fn ports() -> HashSet<u16> {
            [50000].into_iter().collect()
        }

        fn pktmon_event(metadata: &[u8], packet: Vec<u8>) -> Vec<u8> {
            let mut event = metadata.to_vec();
            event.extend_from_slice(&packet[..packet.len().min(PKTMON_PKT_SIZE as usize)]);
            event
        }

        fn game_payload() -> Vec<u8> {
            vec![0x5a; 400]
        }

        fn ipv4_frame(src: ([u8; 4], u16), dst: ([u8; 4], u16)) -> Vec<u8> {
            let mut frame = Vec::new();
            PacketBuilder::ethernet2([1; 6], [2; 6])
                .ipv4(src.0, dst.0, 64)
                .udp(src.1, dst.1)
                .write(&mut frame, &game_payload())
                .unwrap();
            frame
        }

        #[test]
        fn pktmon_starts_in_real_time_with_small_packets_and_a_tiny_file() {
            assert_eq!(
                pktmon_start_args(Some(1)).join(" "),
                "start --capture --log-mode real-time --pkt-size 64 --file-size 1"
            );
            assert_eq!(
                pktmon_start_args(None).join(" "),
                "start --capture --log-mode real-time --pkt-size 64"
            );
        }

        #[test]
        fn outgoing_ipv4_packet_truncated_to_pkt_size_is_counted() {
            let event = pktmon_event(&[0xaa; 38], ipv4_frame((LOCAL, 50000), (SERVER, 7777)));
            assert_eq!(event.len(), 38 + 64);
            assert_eq!(
                endpoint_from_pktmon_event(&event, &ports()),
                Some((50000, "203.0.113.5".to_string(), 7777))
            );
        }

        #[test]
        fn incoming_ipv4_packet_truncated_to_pkt_size_is_counted() {
            let event = pktmon_event(&[0xaa; 38], ipv4_frame((SERVER, 7777), (LOCAL, 50000)));
            assert_eq!(
                endpoint_from_pktmon_event(&event, &ports()),
                Some((50000, "203.0.113.5".to_string(), 7777))
            );
        }

        #[test]
        fn ipv6_packet_truncated_to_pkt_size_is_counted() {
            let mut frame = Vec::new();
            PacketBuilder::ethernet2([1; 6], [2; 6])
                .ipv6(LOCAL6, SERVER6, 64)
                .udp(50000, 3074)
                .write(&mut frame, &game_payload())
                .unwrap();
            let event = pktmon_event(&[0xaa; 38], frame);
            assert_eq!(event.len(), 38 + 64);
            assert_eq!(
                endpoint_from_pktmon_event(&event, &ports()),
                Some((50000, "2001:db8:1::5".to_string(), 3074))
            );
        }

        #[test]
        fn vlan_tagged_ipv4_packet_truncated_to_pkt_size_is_counted() {
            let mut frame = Vec::new();
            PacketBuilder::ethernet2([1; 6], [2; 6])
                .single_vlan(VlanId::try_new(10).unwrap())
                .ipv4(LOCAL, SERVER, 64)
                .udp(50000, 7777)
                .write(&mut frame, &game_payload())
                .unwrap();
            assert_eq!(
                endpoint_from_pktmon_event(&pktmon_event(&[0xaa; 38], frame), &ports()),
                Some((50000, "203.0.113.5".to_string(), 7777))
            );
        }

        #[test]
        fn a_false_signature_in_the_metadata_does_not_hide_the_frame() {
            let mut metadata = [0xaa; 38];
            metadata[16..19].copy_from_slice(&[0x08, 0x00, 0x45]);
            let event = pktmon_event(&metadata, ipv4_frame((LOCAL, 50000), (SERVER, 7777)));
            assert_eq!(
                endpoint_from_pktmon_event(&event, &ports()),
                Some((50000, "203.0.113.5".to_string(), 7777))
            );
        }

        #[test]
        fn raw_ip_packet_at_a_known_offset_is_counted() {
            let mut packet = Vec::new();
            PacketBuilder::ipv4(SERVER, LOCAL, 64)
                .udp(7777, 50000)
                .write(&mut packet, &game_payload())
                .unwrap();
            let event = pktmon_event(&[0xaa; 48], packet);
            assert_eq!(
                endpoint_from_pktmon_event(&event, &ports()),
                Some((50000, "203.0.113.5".to_string(), 7777))
            );
        }

        #[test]
        fn traffic_on_other_ports_is_ignored() {
            let event = pktmon_event(&[0xaa; 38], ipv4_frame((LOCAL, 50001), (SERVER, 7777)));
            assert_eq!(endpoint_from_pktmon_event(&event, &ports()), None);
            assert_eq!(endpoint_from_pktmon_event(&[0xaa; 20], &ports()), None);
        }

        fn session(events: u32, realtime: u32, file: u32) -> SessionStats {
            use windows_sys::Win32::System::Diagnostics::Etw::EVENT_TRACE_PROPERTIES;
            let props = EVENT_TRACE_PROPERTIES {
                LogFileMode: 0x0880_0100,
                MaximumFileSize: 1,
                BufferSize: 16,
                EventsLost: events,
                BuffersWritten: 100,
                LogBuffersLost: file,
                RealTimeBuffersLost: realtime,
                ..Default::default()
            };
            SessionStats::from_properties(&props, r"C:\Windows\system32\PktMon.etl".to_string())
        }

        #[test]
        fn session_counters_are_read_from_the_query_properties() {
            let stats = session(2, 3, 293_068);
            assert!(stats.is_real_time());
            assert_eq!(stats.realtime_buffers_lost, 3);
            assert_eq!(stats.log_buffers_lost, 293_068);
            assert!(stats.describe().contains("max 1 MB"));
            assert!(!SessionStats { log_file_mode: 0x1, ..stats }.is_real_time());
        }

        #[test]
        fn capture_losses_are_the_session_delta_over_the_window() {
            let losses = session(5, 7, 400).losses_since(&session(2, 7, 100));
            assert_eq!(losses, SessionLosses { events: 3, realtime_buffers: 0, file_buffers: 300 });
            let wrapped = session(1, 0, 0).losses_since(&session(u32::MAX, 0, 0));
            assert_eq!(wrapped.events, 2);
        }

        #[test]
        fn wide_names_stop_at_the_first_nul() {
            let mut wide = encode_wide("PktMon");
            wide.extend([b'x' as u16; 4]);
            assert_eq!(wide_until_nul(&wide), "PktMon");
        }
    }
}

fn main() {
    if let Err(e) = service::run() {
        eprintln!("Service error: {}", e);
        std::process::exit(1);
    }
}
