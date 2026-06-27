/**
 * Custom Next.js server with an integrated socket.io signaling plane.
 *
 * Why a custom server: WebRTC needs a low-latency, bidirectional signaling
 * channel. socket.io (WebSocket with graceful fallbacks) is the primary transport.
 * The SSE Route Handler at /api/signaling remains as an independent fallback for
 * environments where the WebSocket upgrade is blocked.
 *
 * No file bytes ever pass through here — socket.io only relays SDP offers/answers
 * and ICE candidates so two browsers can find each other. Once the RTCDataChannel
 * is open this server goes idle.
 *
 * Run:  node server.js            (dev)
 *       NODE_ENV=production node server.js
 */

const { createServer } = require("http");
const { createServer: createHttpsServer } = require("https");
const fs = require("fs");
const next = require("next");
const { Server } = require("socket.io");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// ---------------------------------------------------------------------------
// Room derivation (mirrors lib/room.ts; duplicated here because this CJS server
// cannot import the app's TS modules).
// ---------------------------------------------------------------------------
const crypto = require("crypto");

function isRoutablePublicIp(ip) {
  if (!ip || ip === "::1" || ip === "127.0.0.1") return false;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts;
    if (a === 10 || a === 127) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
    return true;
  }
  return ip.includes(":");
}

function deriveRoom(headers, address, code) {
  if (code && String(code).trim()) {
    return "code:" + String(code).trim().toUpperCase().slice(0, 12);
  }
  const fwd =
    headers["x-forwarded-for"] || headers["x-real-ip"] || headers["cf-connecting-ip"] || "";
  const ip = (String(fwd).split(",")[0] || "").trim() || address || "";
  if (ip && isRoutablePublicIp(ip)) {
    const hash = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 10);
    return "ip:" + hash;
  }
  return "lan:lobby";
}

const ADJECTIVES = ["Cobalt","Neon","Lunar","Quantum","Velvet","Crimson","Solar","Cyan","Onyx","Aurora","Nimbus","Zephyr","Echo","Vortex"];
const NOUNS = ["Falcon","Otter","Comet","Maple","Raven","Pixel","Nova","Lynx","Quartz","Drift","Ember","Orbit","Willow","Sparrow"];
function randomName(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const a = ADJECTIVES[Math.abs(h) % ADJECTIVES.length];
  const n = NOUNS[Math.abs(h >> 8) % NOUNS.length];
  return a + " " + n;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
app.prepare().then(() => {
  // Serve over HTTPS when a cert/key pair is provided (see `pnpm dev:https`).
  // A secure context is what unblocks WebRTC for devices opening the LAN URL.
  const certPath = process.env.SSL_CERT;
  const keyPath = process.env.SSL_KEY;
  const useHttps =
    !!certPath && !!keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath);

  const requestHandler = (req, res) => handle(req, res);
  const httpServer = useHttps
    ? createHttpsServer(
        { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
        requestHandler
      )
    : createServer(requestHandler);

  const io = new Server(httpServer, {
    path: "/ws",
    cors: { origin: true, credentials: true },
    // Keep payloads tiny — only signaling JSON travels here.
    maxHttpBufferSize: 1e6,
  });

  io.on("connection", async (socket) => {
    const q = socket.handshake.query;
    const peerId = String(q.peerId || socket.id);
    const code = q.code ? String(q.code) : "";
    const name = (q.name && String(q.name).slice(0, 24)) || randomName(peerId);

    const room = deriveRoom(
      socket.handshake.headers,
      socket.handshake.address,
      code
    );
    const self = { id: peerId, name, joinedAt: Date.now() };

    socket.data = { peerId, room, info: self };
    await socket.join(room);

    // Current roster (everyone else already in the room).
    const sockets = await io.in(room).fetchSockets();
    const peers = sockets
      .filter((s) => s.data?.peerId && s.data.peerId !== peerId)
      .map((s) => s.data.info);

    socket.emit("signal", { kind: "welcome", self, room, peers });
    socket.to(room).emit("signal", { kind: "peer-joined", peer: self });

    // Relay directed signals (offer / answer / ice) to the target peer.
    socket.on("signal", (msg) => {
      if (!msg || !msg.to) return;
      const target = sockets; // re-fetch live each time for correctness
      io.in(room)
        .fetchSockets()
        .then((live) => {
          const dest = live.find((s) => s.data?.peerId === msg.to);
          if (dest) dest.emit("signal", { ...msg, from: peerId });
        })
        .catch(() => {});
      void target;
    });

    socket.on("disconnect", () => {
      socket.to(room).emit("signal", { kind: "peer-left", peerId });
    });
  });

  httpServer.listen(port, hostname, () => {
    const proto = useHttps ? "https" : "http";
    const shown = hostname === "0.0.0.0" ? "localhost" : hostname;
    console.log(`\n  ▲ mjshare ready${useHttps ? " (HTTPS)" : ""}`);
    console.log(`  • Local:   ${proto}://${shown}:${port}`);
    console.log(`  • Network: ${proto}://<your-LAN-IP>:${port}  (open this on other devices)`);
    if (!useHttps) {
      console.log(`  • Tip: run \`pnpm dev:https\` so the LAN URL is a secure context (WebRTC needs it).`);
    }
    console.log(`  • Signaling: socket.io on /ws  (SSE fallback on /api/signaling)\n`);
  });
});
