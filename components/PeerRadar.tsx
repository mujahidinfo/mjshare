"use client";

import type { PeerInfo, Transfer } from "@/lib/types";
import { ArrowRight, Monitor, Radar } from "./icons";

interface PeerRadarProps {
  peers: PeerInfo[];
  transfers: Transfer[];
  hasStagedFiles: boolean;
  onSelectPeer: (peer: PeerInfo) => void;
}

type PeerState = "idle" | "connecting" | "connected";

function peerState(peerId: string, transfers: Transfer[]): PeerState {
  const active = transfers.filter((t) => t.peerId === peerId);
  if (active.some((t) => t.status === "transferring")) return "connected";
  if (active.some((t) => t.status === "connecting" || t.status === "pending"))
    return "connecting";
  return "idle";
}

const STATE_BADGE: Record<PeerState, { label: string; cls: string; dot: string }> = {
  connected: {
    label: "Connected",
    cls: "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-400",
  },
  connecting: {
    label: "Connecting",
    cls: "border-amber-400/25 bg-amber-400/[0.08] text-amber-700 dark:text-amber-300",
    dot: "bg-amber-400 animate-pulse",
  },
  idle: {
    label: "Idle",
    cls: "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]",
    dot: "bg-slate-500",
  },
};

/**
 * "Nearby Devices" radar. Empty rooms show an animated sweep; as peers join they
 * appear as selectable cards with live status badges.
 */
export function PeerRadar({
  peers,
  transfers,
  hasStagedFiles,
  onSelectPeer,
}: PeerRadarProps) {
  return (
    <section className="glass flex flex-col p-5 sm:p-6">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Radar size={18} className="text-[var(--accent)]" />
          <div>
            <h2 className="text-sm font-medium text-[var(--text-2)]">Nearby devices</h2>
            <p className="text-xs text-[var(--text-subtle)]">Same network · auto-discovered</p>
          </div>
        </div>
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-xs tabular-nums text-[var(--text-2)]">
          {peers.length} online
        </span>
      </header>

      {peers.length === 0 ? (
        <EmptyRadar />
      ) : (
        <ul className="grid grid-cols-1 gap-2.5">
          {peers.map((peer) => {
            const state = peerState(peer.id, transfers);
            const badge = STATE_BADGE[state];
            return (
              <li key={peer.id}>
                <button
                  type="button"
                  onClick={() => onSelectPeer(peer)}
                  className="glass-hover focus-ring group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-left"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]">
                    <Monitor size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[var(--text)]">
                      {peer.name}
                    </span>
                    <span
                      className={`mt-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                      {badge.label}
                    </span>
                  </span>
                  <span
                    className={[
                      "flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                      hasStagedFiles
                        ? "bg-brand-600 text-white group-hover:bg-brand-500"
                        : "border border-[var(--border)] text-[var(--text-muted)]",
                    ].join(" ")}
                  >
                    {hasStagedFiles ? (
                      <>
                        Send <ArrowRight size={14} />
                      </>
                    ) : (
                      "Select"
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function EmptyRadar() {
  return (
    <div className="relative flex flex-1 items-center justify-center py-10">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute h-20 w-20 rounded-full border border-brand-400/20 motion-safe:animate-radar-ping"
          style={{ animationDelay: `${i * 0.85}s` }}
        />
      ))}
      <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full border border-brand-400/30 bg-brand-500/[0.08] text-[var(--accent)]">
        <Radar size={22} />
      </div>
      <p className="absolute -bottom-1 text-center text-xs text-[var(--text-subtle)]">
        Scanning the network…
      </p>
    </div>
  );
}
