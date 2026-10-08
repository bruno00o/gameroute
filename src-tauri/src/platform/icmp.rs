use std::io;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Instant;
use windows_sys::Win32::Foundation::{GetLastError, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::NetworkManagement::IpHelper::{
    Icmp6CreateFile, Icmp6SendEcho2, IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho2,
    ICMPV6_ECHO_REPLY_LH, ICMP_ECHO_REPLY, IP_OPTION_INFORMATION, IP_REQ_TIMED_OUT, IP_SUCCESS,
    IP_TTL_EXPIRED_TRANSIT,
};
use windows_sys::Win32::Networking::WinSock::{AF_INET6, SOCKADDR_IN6};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EchoStatus {
    Reply,
    TtlExpired,
    TimedOut,
    Failed(u32),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EchoReply {
    pub status: EchoStatus,
    pub from: Option<IpAddr>,
    pub elapsed_ms: f64,
}

impl EchoReply {
    pub fn answered(&self) -> bool {
        matches!(self.status, EchoStatus::Reply | EchoStatus::TtlExpired)
    }
}

pub struct IcmpSocket {
    handle: HANDLE,
    v6: bool,
}

unsafe impl Send for IcmpSocket {}

impl IcmpSocket {
    pub fn open(v6: bool) -> io::Result<Self> {
        let handle = unsafe {
            if v6 {
                Icmp6CreateFile()
            } else {
                IcmpCreateFile()
            }
        };
        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        Ok(Self { handle, v6 })
    }

    pub fn echo(
        &self,
        destination: IpAddr,
        ttl: Option<u8>,
        payload: &[u8],
        timeout_ms: u32,
    ) -> io::Result<EchoReply> {
        let options = IP_OPTION_INFORMATION {
            Ttl: ttl.unwrap_or(128),
            Tos: 0,
            Flags: 0,
            OptionsSize: 0,
            OptionsData: std::ptr::null_mut(),
        };
        let mut buffer = vec![0u64; (payload.len() + 256).div_ceil(8)];
        let size = (buffer.len() * 8) as u32;
        let started = Instant::now();
        let count = match (destination, self.v6) {
            (IpAddr::V4(address), false) => unsafe {
                IcmpSendEcho2(
                    self.handle,
                    std::ptr::null_mut(),
                    None,
                    std::ptr::null(),
                    u32::from_ne_bytes(address.octets()),
                    payload.as_ptr().cast(),
                    payload.len() as u16,
                    &options,
                    buffer.as_mut_ptr().cast(),
                    size,
                    timeout_ms,
                )
            },
            (IpAddr::V6(address), true) => {
                let source = sockaddr_in6(Ipv6Addr::UNSPECIFIED);
                let target = sockaddr_in6(address);
                unsafe {
                    Icmp6SendEcho2(
                        self.handle,
                        std::ptr::null_mut(),
                        None,
                        std::ptr::null(),
                        &source,
                        &target,
                        payload.as_ptr().cast(),
                        payload.len() as u16,
                        &options,
                        buffer.as_mut_ptr().cast(),
                        size,
                        timeout_ms,
                    )
                }
            }
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "address family does not match the ICMP handle",
                ))
            }
        };
        let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;

        if count == 0 {
            let code = unsafe { GetLastError() };
            let status = if code == IP_REQ_TIMED_OUT {
                EchoStatus::TimedOut
            } else {
                EchoStatus::Failed(code)
            };
            return Ok(EchoReply {
                status,
                from: None,
                elapsed_ms,
            });
        }

        let (status, from) = if self.v6 {
            let reply =
                unsafe { std::ptr::read_unaligned(buffer.as_ptr().cast::<ICMPV6_ECHO_REPLY_LH>()) };
            let words = reply.Address.sin6_addr;
            let mut bytes = [0u8; 16];
            for (chunk, word) in bytes.chunks_exact_mut(2).zip(words) {
                chunk.copy_from_slice(&word.to_ne_bytes());
            }
            (reply.Status, IpAddr::V6(Ipv6Addr::from(bytes)))
        } else {
            let reply =
                unsafe { std::ptr::read_unaligned(buffer.as_ptr().cast::<ICMP_ECHO_REPLY>()) };
            (
                reply.Status,
                IpAddr::V4(Ipv4Addr::from(reply.Address.to_ne_bytes())),
            )
        };
        let status = match status {
            IP_SUCCESS => EchoStatus::Reply,
            IP_TTL_EXPIRED_TRANSIT => EchoStatus::TtlExpired,
            IP_REQ_TIMED_OUT => EchoStatus::TimedOut,
            other => EchoStatus::Failed(other),
        };
        Ok(EchoReply {
            status,
            from: Some(from),
            elapsed_ms,
        })
    }
}

impl Drop for IcmpSocket {
    fn drop(&mut self) {
        unsafe {
            IcmpCloseHandle(self.handle);
        }
    }
}

fn sockaddr_in6(address: Ipv6Addr) -> SOCKADDR_IN6 {
    let mut socket = SOCKADDR_IN6 {
        sin6_family: AF_INET6,
        ..SOCKADDR_IN6::default()
    };
    socket.sin6_addr.u.Byte = address.octets();
    socket
}
