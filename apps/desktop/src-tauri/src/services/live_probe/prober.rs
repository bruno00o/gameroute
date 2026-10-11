use super::engine::{Probe, ProbeReply};
use super::stats::round;
use crate::config::{LIVE_PROBE_PAYLOAD, LIVE_PROBE_TIMEOUT_MS};
use crate::models::live_probe::ProbeProtocol;
use crate::platform::icmp::{EchoStatus, IcmpSocket};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, UdpSocket};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

pub trait Prober: Send + Sync + 'static {
    fn probe(&self, probe: &Probe) -> ProbeReply;
}

#[derive(Default)]
pub struct SystemProber {
    sockets: Mutex<HashMap<SocketAddr, UdpSocket>>,
}

impl Prober for SystemProber {
    fn probe(&self, probe: &Probe) -> ProbeReply {
        match probe.protocol {
            ProbeProtocol::Icmp => icmp(probe),
            ProbeProtocol::Udp => self.udp(probe).unwrap_or_default(),
        }
    }
}

fn icmp(probe: &Probe) -> ProbeReply {
    let echo = IcmpSocket::open(probe.ip.is_ipv6()).and_then(|socket| {
        socket.echo(
            probe.ip,
            probe.ttl,
            LIVE_PROBE_PAYLOAD,
            LIVE_PROBE_TIMEOUT_MS,
        )
    });
    match echo {
        Ok(reply) if reply.answered() => ProbeReply {
            rtt_ms: Some(round(reply.elapsed_ms)),
            from: reply.from,
            at_destination: reply.status == EchoStatus::Reply,
        },
        Ok(_) => ProbeReply::default(),
        Err(e) => {
            log::debug!("ICMP probe to {} failed: {}", probe.ip, e);
            ProbeReply::default()
        }
    }
}

impl SystemProber {
    fn udp(&self, probe: &Probe) -> Option<ProbeReply> {
        let target = SocketAddr::new(probe.ip, probe.port?);
        let cached = self
            .sockets
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&target);
        let socket = match cached {
            Some(socket) => socket,
            None => open_udp(target).ok()?,
        };
        let reply = udp_echo(&socket);
        self.sockets
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(target, socket);
        reply.map(|rtt_ms| ProbeReply {
            rtt_ms: Some(rtt_ms),
            from: Some(probe.ip),
            at_destination: true,
        })
    }
}

fn open_udp(target: SocketAddr) -> std::io::Result<UdpSocket> {
    let local: SocketAddr = match target {
        SocketAddr::V4(_) => (Ipv4Addr::UNSPECIFIED, 0).into(),
        SocketAddr::V6(_) => (Ipv6Addr::UNSPECIFIED, 0).into(),
    };
    let socket = UdpSocket::bind(local)?;
    socket.connect(target)?;
    socket.set_read_timeout(Some(Duration::from_millis(u64::from(
        LIVE_PROBE_TIMEOUT_MS,
    ))))?;
    Ok(socket)
}

fn udp_echo(socket: &UdpSocket) -> Option<f64> {
    let mut buffer = [0u8; 512];
    if socket.set_nonblocking(true).is_ok() {
        while socket.recv(&mut buffer).is_ok() {}
        socket.set_nonblocking(false).ok()?;
    }
    let started = Instant::now();
    socket.send(LIVE_PROBE_PAYLOAD).ok()?;
    socket.recv(&mut buffer).ok()?;
    Some(round(started.elapsed().as_secs_f64() * 1000.0))
}

pub fn resolve(address: &str) -> Option<IpAddr> {
    if let Ok(ip) = address.parse() {
        return Some(ip);
    }
    use std::net::ToSocketAddrs;
    let addresses: Vec<SocketAddr> = (address, 0).to_socket_addrs().ok()?.collect();
    addresses
        .iter()
        .find(|address| address.is_ipv4())
        .or_else(|| addresses.first())
        .map(SocketAddr::ip)
}
