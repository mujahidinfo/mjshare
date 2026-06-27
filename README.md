# mjshare

Zero-server-storage, peer-to-peer file sharing built **entirely inside a single Next.js app** (App Router · TypeScript · **Tailwind CSS v4**). Files stream browser-to-browser over an encrypted WebRTC data channel and never touch the server — the server only relays the handshake that lets two devices find each other.

> **Stack:** Next.js 16 · React 19 · Tailwind CSS v4 · socket.io 4 · WebRTC

## Highlights

- **socket.io signaling over a custom Next.js server** (`server.js`) — a real WebSocket plane on `/ws`, with an **SSE + POST fallback** (`/api/signaling`) that kicks in automatically when the WebSocket upgrade is blocked. No external backend, no database; room state lives in memory.
- **Automatic same-network discovery.** Devices are grouped into a room automatically (shared public IP behind a proxy, otherwise a shared LAN lobby).
- **Shareable join links.** Generate a private room link (`/?room=CODE`), copy it, and open it on another device to land in the same room instantly. Manual code entry is also supported.
- **Multi-gigabyte files, flat RAM.** Lazy `Blob.slice()` reads 64 KB chunks; the receiver streams them straight to disk via the **File System Access API** (`FileSystemWritableFileStream`), falling back to an in-RAM Blob with a warning only when unsupported.
- **Strict ACK backpressure.** The sender ships exactly one chunk, then blocks until the receiver writes it and replies `"ACK"` — at most one chunk in flight, so the WebRTC send buffer can't overflow.
- **Minimal, aesthetic dark UI.** Inter typography, glassmorphism surfaces, SVG iconography (no emoji), animated radar, live progress / speed / ETA, `prefers-reduced-motion` aware.

## Quick start (single machine)

```bash
pnpm install
pnpm dev            # custom server: node server.js
# open http://localhost:3000 in two browser tabs
```

Production:

```bash
pnpm build
pnpm start          # NODE_ENV=production node server.js
```

> First install only: pnpm asks to approve `sharp`'s build script (a Next image dep).
> It's already approved in `pnpm-workspace.yaml`; if you see a prompt, run
> `pnpm approve-builds --all`.

---

## 📡 Use it across two devices on your local network

Both devices must be on the **same Wi-Fi / LAN**.

### 1. Find your computer's LAN IP (the machine running mjshare)

| OS | Command | Looks like |
|----|---------|-----------|
| Linux | `hostname -I` | `192.168.1.42` |
| macOS | `ipconfig getifaddr en0` | `192.168.1.42` |
| Windows | `ipconfig` → "IPv4 Address" | `192.168.1.42` |

### 2. Start the server bound to all interfaces (it already is)

```bash
pnpm build && pnpm start          # listens on 0.0.0.0:3000
# or: HOST=0.0.0.0 PORT=3000 pnpm dev
```

### 3. Open it on both devices

- **Device A (the host):** `http://localhost:3000`
- **Device B (phone/laptop):** `http://192.168.1.42:3000`  ← your LAN IP from step 1

They'll appear in each other's **Nearby devices** list automatically. Drop a file on one, click the other device, accept on the receiver — done.

### ⚠️ The HTTPS / secure-context catch (important)

WebRTC only runs in a **secure context**: `https://` **or** `localhost`. So:

- `http://localhost:3000` on the host works (localhost is exempt).
- `http://192.168.1.42:3000` on the **other** device is **not** a secure context — the browser will **block the P2P connection**. The app shows a red banner when it detects this.

**Recommended — `pnpm dev:https` (mkcert):**

One command mints a locally-trusted certificate covering `localhost` + your LAN IP and boots mjshare over HTTPS:

```bash
# one-time: install mkcert
#   macOS:   brew install mkcert nss
#   Linux:   sudo apt install libnss3-tools   (then install the mkcert binary)
#   Windows: choco install mkcert

pnpm dev:https
```

It prints exactly which URLs to open:

```
Open on this machine:  https://localhost:3000
Open on other devices: https://192.168.1.42:3000
```

The cert is written to `./certs` (gitignored) and reused on later runs — so `dev:https` works even if mkcert isn't on PATH the next time. On the **second device**, either install mkcert's root CA (`mkcert -CAROOT` shows where it lives) or just tap through the one-time browser trust warning — proceeding still yields a secure `https://` context, which is all WebRTC needs.

> Custom cert paths: the server also honours `SSL_CERT` and `SSL_KEY` env vars
> directly (`SSL_CERT=… SSL_KEY=… pnpm start`), so you can plug in your own.

**Alternative — a tunnel** (`cloudflared tunnel --url http://localhost:3000` or `ngrok http 3000`): gives a public `https://…` URL both devices can open. A tunnel routes through the internet, so devices group by shared **public IP** rather than the LAN lobby — use a **join link** to be sure you share a room.

**Alternative — code-share regardless of network:** click **Create join link** on one device and open that link on the other. As long as both reach the same mjshare server over HTTPS, they share a room.

---

## Architecture

```
Browser A ──┐                                   ┌── Browser B
            │  socket.io /ws  (or SSE fallback)  │
            └──►  custom Next.js server  ◄───────┘     ← SDP + ICE only
            ╚═══════════ WebRTC DataChannel ═══════════╝
                       (all file bytes, P2P)
```

| Layer | File |
|-------|------|
| Custom server + socket.io signaling | `server.js` |
| SSE + POST fallback signaling | `app/api/signaling/route.ts` |
| In-memory room/peer store (SSE) | `lib/signaling-store.ts` |
| Room derivation + names | `lib/room.ts` |
| WebRTC + transfer engine | `lib/PeerManager.ts` |
| Signaling hook (socket.io ⇄ SSE) | `hooks/useSignaling.ts` |
| Engine ↔ React adapter | `hooks/usePeerConnections.ts` |
| UI | `app/page.tsx`, `components/*` |
| SVG icon set | `components/icons.tsx` |

## Transfer protocol (over the data channel)

1. Sender → `{t:"meta", id, name, size, mime}`
2. Receiver shows Accept/Decline. On **Accept** (a user gesture — required for the
   save dialog) → `{t:"meta-ack", id}`; on Decline → `{t:"meta-decline", id}`.
3. Sender loops: send a 64 KB binary chunk → **wait for `"ACK"`** → next chunk.
4. Sender → `{t:"done", id}`; receiver closes the file / triggers download.
   Either side may send `{t:"cancel", id}` at any time.

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `HOST` | `0.0.0.0` | Interface the server binds to |
| `PORT` | `3000` | Port |
| `NODE_ENV` | — | `production` enables the optimized build |
| `SSL_CERT` | — | Path to a TLS cert (PEM). When set with `SSL_KEY`, the server serves HTTPS. |
| `SSL_KEY` | — | Path to the TLS private key (PEM). |
