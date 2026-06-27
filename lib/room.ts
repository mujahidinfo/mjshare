import { createHash } from "crypto";

/**
 * Derive which room a connecting client belongs to.
 *
 * Priority:
 *   1. An explicit manual short-code (?code=ABCD)  -> "code:ABCD"
 *   2. The client's public IP, when the server sits behind a proxy/CDN and can
 *      see `x-forwarded-for`. Devices behind the same NAT share a public IP, so
 *      they land in the same room automatically.            -> "ip:<hash>"
 *   3. Fallback: a single shared LAN lobby. When you run this app on a machine on
 *      your Wi-Fi, every device hits the same server instance over the LAN and
 *      the per-socket remote address is each device's *private* IP (all different),
 *      so IP grouping is useless there. The shared lobby is what actually makes
 *      "everyone on this Wi-Fi sees each other" work for the local use case.
 *
 * We hash the IP so a room id never leaks a raw address to other clients.
 */
export function deriveRoom(headers: Headers, code?: string | null): string {
  if (code && code.trim()) {
    return "code:" + code.trim().toUpperCase().slice(0, 12);
  }

  const fwd =
    headers.get("x-forwarded-for") ??
    headers.get("x-real-ip") ??
    headers.get("cf-connecting-ip") ??
    "";
  const ip = fwd.split(",")[0]?.trim();

  if (ip && isRoutablePublicIp(ip)) {
    const hash = createHash("sha256").update(ip).digest("hex").slice(0, 10);
    return "ip:" + hash;
  }

  return "lan:lobby";
}

/** Quick check that an IP looks like a real, non-private, routable address. */
function isRoutablePublicIp(ip: string): boolean {
  if (!ip || ip === "::1" || ip === "127.0.0.1") return false;
  // Strip IPv6-mapped IPv4 prefix.
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts;
    if (a === 10) return false; // 10.0.0.0/8
    if (a === 127) return false; // loopback
    if (a === 192 && b === 168) return false; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
    if (a === 169 && b === 254) return false; // link-local
    return true;
  }
  // Some IPv6 address we don't classify — treat as public.
  return ip.includes(":");
}

/** Generate a friendly, human-pronounceable peer name. */
const ADJECTIVES = [
  "Cobalt", "Neon", "Lunar", "Quantum", "Velvet", "Crimson", "Solar",
  "Cyan", "Onyx", "Aurora", "Nimbus", "Zephyr", "Echo", "Vortex",
];
const NOUNS = [
  "Falcon", "Otter", "Comet", "Maple", "Raven", "Pixel", "Nova",
  "Lynx", "Quartz", "Drift", "Ember", "Orbit", "Willow", "Sparrow",
];

export function randomName(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const a = ADJECTIVES[Math.abs(h) % ADJECTIVES.length];
  const n = NOUNS[Math.abs(h >> 8) % NOUNS.length];
  return `${a} ${n}`;
}
