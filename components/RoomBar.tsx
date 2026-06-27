"use client";

import type { SignalingStatus, SignalingTransport } from "@/hooks/useSignaling";
import type { PeerInfo } from "@/lib/types";
import { Wifi } from "./icons";

interface RoomBarProps {
  status: SignalingStatus;
  transport: SignalingTransport | null;
  room: string;
  self: PeerInfo | null;
}

const STATUS_META: Record<SignalingStatus, { label: string; dot: string }> = {
  online: { label: "Online", dot: "bg-emerald-400" },
  connecting: { label: "Connecting", dot: "bg-amber-400 animate-pulse" },
  offline: { label: "Reconnecting", dot: "bg-rose-400 animate-pulse" },
};

function prettyRoom(room: string): string {
  if (room.startsWith("code:")) return `Room ${room.slice(5)}`;
  if (room.startsWith("ip:")) return "Auto · shared network";
  if (room === "lan:lobby") return "Local lobby";
  return room || "…";
}

/** Top bar: live signaling status, transport, your device name and room. */
export function RoomBar({ status, transport, room, self }: RoomBarProps) {
  const meta = STATUS_META[status];

  return (
    <div className="glass flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2.5 text-sm">
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium">
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          {meta.label}
        </span>
        <span className="hidden items-center gap-1.5 text-xs text-[var(--text-subtle)] sm:inline-flex">
          <Wifi size={14} className="text-[var(--text-subtle)]" />
          {transport === "socket.io" ? "WebSocket" : transport === "sse" ? "SSE fallback" : "…"}
        </span>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-[var(--text-subtle)]">You are</span>
        <span className="font-medium text-[var(--accent)]">{self?.name ?? "…"}</span>
        <span className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
          {prettyRoom(room)}
        </span>
      </div>
    </div>
  );
}
