const NON_PUBLIC_IPV4: [number, number][] = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 3],
]

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null
    const byte = Number(part)
    if (byte > 255) return null
    value = value * 256 + byte
  }
  return value
}

function ipv6Groups(ip: string): number[] | null {
  if (!/^[0-9a-f:]+$/i.test(ip)) return null
  const halves = ip.split('::')
  if (halves.length > 2) return null
  const parse = (half: string) => (half === '' ? [] : half.split(':'))
  const head = parse(halves[0])
  const tail = halves.length === 2 ? parse(halves[1]) : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...Array(missing).fill('0'), ...tail]
  if (groups.some(group => !/^[0-9a-f]{1,4}$/i.test(group))) return null
  return groups.map(group => Number.parseInt(group, 16))
}

export function isPublicIp(ip: string): boolean {
  const v4 = ipv4ToInt(ip)
  if (v4 != null) {
    return !NON_PUBLIC_IPV4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
      return (v4 & mask) >>> 0 === base
    })
  }
  const v6 = ipv6Groups(ip)
  if (v6 == null) return false
  const globalUnicast = (v6[0] & 0xe000) === 0x2000
  const documentation = v6[0] === 0x2001 && v6[1] === 0x0db8
  return globalUnicast && !documentation
}
