import type { NextRequest } from "next/server";
import { Signaling } from "@/lib/signaling-store";
import { deriveRoom, randomName } from "@/lib/room";
import type { PeerInfo, SignalMessage } from "@/lib/types";

/**
 * WebRTC signaling server implemented as a single Next.js Route Handler.
 *
 *   GET  /api/signaling?peerId=...&code=...   -> opens a Server-Sent Events stream
 *                                                (server -> this browser push channel)
 *   POST /api/signaling                        -> client -> server message (relayed
 *                                                to the target peer's SSE stream)
 *
 * No file bytes ever pass through here — only SDP offers/answers and ICE candidates.
 * Once the peers connect, this endpoint goes idle.
 */

// SSE requires a long-lived streaming response — force the Node.js runtime and
// disable any caching/static optimization.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function sseFrame(msg: SignalMessage): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(msg)}\n\n`);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const peerId = url.searchParams.get("peerId");
  const code = url.searchParams.get("code");
  const nameParam = url.searchParams.get("name");

  if (!peerId) {
    return new Response("peerId required", { status: 400 });
  }

  const room = deriveRoom(req.headers, code);
  const self: PeerInfo = {
    id: peerId,
    name: (nameParam && nameParam.slice(0, 24)) || randomName(peerId),
    joinedAt: Date.now(),
  };

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (msg: SignalMessage) => {
        if (closed) return;
        try {
          controller.enqueue(sseFrame(msg));
        } catch {
          /* controller already closed */
        }
      };

      // Register this stream and learn who else is already in the room.
      const { peers } = Signaling.join(self, room, send);

      // First frame: tell the client who it is and the current roster.
      send({ kind: "welcome", self, room, peers });

      // Keep the connection alive through proxies that kill idle sockets.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* ignore */
        }
      }, 15000);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      Signaling.leave(self.id);
    },
  });

  // If the client aborts (tab closed), make sure we clean up.
  req.signal.addEventListener("abort", () => {
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    Signaling.leave(self.id);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering
    },
  });
}

export async function POST(req: NextRequest) {
  let body: SignalMessage;
  try {
    body = (await req.json()) as SignalMessage;
  } catch {
    return Response.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  switch (body.kind) {
    case "offer":
    case "answer":
    case "ice":
    case "bye": {
      const delivered = Signaling.relay(body);
      return Response.json({ ok: delivered });
    }
    default:
      return Response.json({ ok: false, error: "unsupported" }, { status: 400 });
  }
}
