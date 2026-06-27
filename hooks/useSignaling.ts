"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { PeerInfo, SignalMessage } from "@/lib/types";

export type SignalingStatus = "connecting" | "online" | "offline";
export type SignalingTransport = "socket.io" | "sse";

interface UseSignalingArgs {
  selfId: string;
  code?: string;
  name?: string;
  /** Directed WebRTC signals (offer/answer/ice). */
  onSignal: (msg: SignalMessage) => void;
  /** Roster changes (list of *other* peers). */
  onPeers: (peers: PeerInfo[]) => void;
  /**
   * Registers the active transport's send function. Called whenever the live
   * transport changes so the WebRTC layer always sends over the working channel.
   */
  onSend: (send: (msg: SignalMessage) => void) => void;
}

interface UseSignalingResult {
  status: SignalingStatus;
  transport: SignalingTransport | null;
  room: string;
  self: PeerInfo | null;
  peers: PeerInfo[];
}

/** POST a signaling message over the SSE fallback plane. */
async function postSignal(msg: SignalMessage): Promise<boolean> {
  try {
    const res = await fetch("/api/signaling", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(msg),
    });
    const data = (await res.json()) as { ok: boolean };
    return data.ok;
  } catch {
    return false;
  }
}

/**
 * Maintains the signaling connection and the live peer roster.
 *
 * Transport strategy: try **socket.io** first (WebSocket, lowest latency). If it
 * cannot establish a connection within a short budget, transparently fall back to
 * the **SSE + POST** plane so signaling still works behind restrictive proxies.
 */
export function useSignaling({
  selfId,
  code,
  name,
  onSignal,
  onPeers,
  onSend,
}: UseSignalingArgs): UseSignalingResult {
  const [status, setStatus] = useState<SignalingStatus>("connecting");
  const [transport, setTransport] = useState<SignalingTransport | null>(null);
  const [room, setRoom] = useState("");
  const [self, setSelf] = useState<PeerInfo | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);

  // Latest callbacks in refs so changing them never forces a reconnect.
  const cbs = useRef({ onSignal, onPeers, onSend });
  cbs.current = { onSignal, onPeers, onSend };

  useEffect(() => {
    if (!selfId) return;

    let stopped = false;
    let roster: PeerInfo[] = [];
    let socket: Socket | null = null;
    let es: EventSource | null = null;
    let sseRetry: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let socketConnected = false;

    const publish = (list: PeerInfo[]) => {
      roster = list;
      setPeers(list);
      cbs.current.onPeers(list);
    };

    // Shared message dispatch for both transports.
    const dispatch = (msg: SignalMessage) => {
      switch (msg.kind) {
        case "welcome":
          setSelf(msg.self);
          setRoom(msg.room);
          publish(msg.peers);
          break;
        case "peer-joined":
          if (!roster.some((p) => p.id === msg.peer.id)) publish([...roster, msg.peer]);
          break;
        case "peer-left":
          publish(roster.filter((p) => p.id !== msg.peerId));
          break;
        case "offer":
        case "answer":
        case "ice":
          cbs.current.onSignal(msg);
          break;
      }
    };

    // ---- SSE fallback plane ----
    const startSSE = () => {
      if (stopped) return;
      setTransport("sse");
      setStatus("connecting");
      cbs.current.onSend((m) => void postSignal(m));

      const params = new URLSearchParams({ peerId: selfId });
      if (code) params.set("code", code);
      if (name) params.set("name", name);
      es = new EventSource(`/api/signaling?${params.toString()}`);
      es.onopen = () => !stopped && setStatus("online");
      es.onmessage = (ev) => {
        try {
          dispatch(JSON.parse(ev.data) as SignalMessage);
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        if (stopped) return;
        setStatus("offline");
        es?.close();
        es = null;
        sseRetry = setTimeout(startSSE, 1500);
      };
    };

    // ---- socket.io primary plane ----
    const startSocket = () => {
      setTransport("socket.io");
      setStatus("connecting");
      socket = io({
        path: "/ws",
        query: { peerId: selfId, code: code ?? "", name: name ?? "" },
        transports: ["websocket", "polling"],
        reconnection: true,
        timeout: 4000,
      });

      socket.on("connect", () => {
        socketConnected = true;
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        setStatus("online");
        cbs.current.onSend((m) => socket?.emit("signal", m));
      });
      socket.on("signal", (msg: SignalMessage) => dispatch(msg));
      socket.on("disconnect", () => !stopped && socketConnected && setStatus("connecting"));
      socket.on("connect_error", () => {
        // Never connected at all -> bail to SSE. (If we *had* connected, let
        // socket.io keep retrying on its own.)
        if (!socketConnected && !stopped) {
          if (fallbackTimer) clearTimeout(fallbackTimer);
          fallbackTimer = null;
          socket?.close();
          socket = null;
          startSSE();
        }
      });

      // Hard budget: if socket.io hasn't connected, switch planes.
      fallbackTimer = setTimeout(() => {
        if (!socketConnected && !stopped) {
          socket?.close();
          socket = null;
          startSSE();
        }
      }, 4500);
    };

    startSocket();

    return () => {
      stopped = true;
      if (sseRetry) clearTimeout(sseRetry);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      socket?.close();
      es?.close();
    };
  }, [selfId, code, name]);

  return { status, transport, room, self, peers };
}
