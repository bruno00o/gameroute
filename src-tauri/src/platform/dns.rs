use std::net::IpAddr;
use std::sync::Once;
use windows_sys::Win32::Networking::WinSock::{
    GetNameInfoW, WSAStartup, AF_INET, AF_INET6, NI_MAXHOST, NI_NAMEREQD, SOCKADDR, SOCKADDR_IN,
    SOCKADDR_IN6, WSADATA,
};

fn start_winsock() {
    static START: Once = Once::new();
    START.call_once(|| unsafe {
        let mut data: WSADATA = std::mem::zeroed();
        WSAStartup(0x0202, &mut data);
    });
}

pub fn reverse_lookup(ip: IpAddr) -> Option<String> {
    start_winsock();
    let mut host = [0u16; NI_MAXHOST as usize];
    let status = match ip {
        IpAddr::V4(address) => {
            let mut socket = SOCKADDR_IN {
                sin_family: AF_INET,
                ..SOCKADDR_IN::default()
            };
            socket.sin_addr.S_un.S_addr = u32::from_ne_bytes(address.octets());
            let pointer = (&raw const socket).cast::<SOCKADDR>();
            unsafe { name_info(pointer, size_of_val(&socket), &mut host) }
        }
        IpAddr::V6(address) => {
            let mut socket = SOCKADDR_IN6 {
                sin6_family: AF_INET6,
                ..SOCKADDR_IN6::default()
            };
            socket.sin6_addr.u.Byte = address.octets();
            let pointer = (&raw const socket).cast::<SOCKADDR>();
            unsafe { name_info(pointer, size_of_val(&socket), &mut host) }
        }
    };
    if status != 0 {
        return None;
    }
    let len = host.iter().position(|&c| c == 0).unwrap_or(host.len());
    let name = String::from_utf16_lossy(&host[..len])
        .trim_end_matches('.')
        .to_lowercase();
    (!name.is_empty() && name.parse::<IpAddr>().is_err()).then_some(name)
}

unsafe fn name_info(socket: *const SOCKADDR, len: usize, host: &mut [u16]) -> i32 {
    GetNameInfoW(
        socket,
        len as i32,
        host.as_mut_ptr(),
        host.len() as u32,
        std::ptr::null_mut(),
        0,
        NI_NAMEREQD as i32,
    )
}
