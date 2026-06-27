"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DropZone } from "@/components/DropZone";
import { HardDrive, Heart, Lock, Radar, Share } from "@/components/icons";
import { JoinLink } from "@/components/JoinLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PeerRadar } from "@/components/PeerRadar";
import { RoomBar } from "@/components/RoomBar";
import { SecurityBanner } from "@/components/SecurityBanner";
import { TransferCard } from "@/components/TransferCard";
import { usePeerConnections } from "@/hooks/usePeerConnections";
import { usePeerId } from "@/hooks/usePeerId";
import { useSignaling } from "@/hooks/useSignaling";
import type { PeerInfo, SignalMessage } from "@/lib/types";

interface QueueItem {
  peerId: string;
  file: File;
}

/** Read an initial room code from `?room=CODE` so invite links auto-join. */
function initialCode(): string {
  if (typeof window === "undefined") return "";
  const c = new URLSearchParams(window.location.search).get("room");
  return c ? c.toUpperCase().slice(0, 12) : "";
}

export default function HomePage() {
  const selfId = usePeerId();

  // A stable signal sender that always routes over the live transport. The
  // signaling hook swaps the underlying implementation (socket.io ⇄ SSE) via the
  // ref without forcing the WebRTC engine to rebuild.
  const sendRef = useRef<(msg: SignalMessage) => void>(() => {});
  const sendSignal = useCallback((msg: SignalMessage) => sendRef.current(msg), []);
  const bindSend = useCallback((fn: (msg: SignalMessage) => void) => {
    sendRef.current = fn;
  }, []);

  const rtc = usePeerConnections(selfId, sendSignal);

  const [code, setCode] = useState(initialCode);

  const applyCode = useCallback((next: string) => {
    setCode(next);
    // Reflect the room in the URL so it can be copied/shared/bookmarked.
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("room", next);
    else url.searchParams.delete("room");
    window.history.replaceState({}, "", url);
  }, []);

  const { status, transport, room, self, peers } = useSignaling({
    selfId,
    code: code || undefined,
    onSignal: rtc.handleSignal,
    onPeers: rtc.setPeers,
    onSend: bindSend,
  });

  // Staged files + send queue.
  const [staged, setStaged] = useState<File[]>([]);
  const [dropKey, setDropKey] = useState(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    if (rtc.notice) showToast(rtc.notice);
  }, [rtc.notice, showToast]);

  // Send strictly one file at a time so the reused data channel never interleaves.
  const sending = rtc.transfers.some(
    (t) =>
      t.direction === "send" &&
      (t.status === "connecting" || t.status === "pending" || t.status === "transferring")
  );

  useEffect(() => {
    if (sending || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    void rtc.sendFile(next.peerId, next.file);
  }, [sending, queue, rtc]);

  const handleSelectPeer = useCallback(
    (peer: PeerInfo) => {
      if (staged.length === 0) {
        showToast("Stage files first, then choose a device.");
        return;
      }
      setQueue((q) => [...q, ...staged.map((file) => ({ peerId: peer.id, file }))]);
      showToast(`Sending ${staged.length} file${staged.length > 1 ? "s" : ""} to ${peer.name}`);
      setStaged([]);
      setDropKey((k) => k + 1);
    },
    [staged, showToast]
  );

  const { active, history } = useMemo(() => {
    const a = rtc.transfers.filter(
      (t) => t.status === "pending" || t.status === "connecting" || t.status === "transferring"
    );
    const h = rtc.transfers.filter(
      (t) => t.status === "completed" || t.status === "cancelled" || t.status === "error"
    );
    return { active: a, history: h };
  }, [rtc.transfers]);

  const features = [
    {
      Icon: Radar,
      title: "Auto-discovery",
      body: "Devices on the same network share a room. No accounts — with a private link fallback when you need one.",
    },
    {
      Icon: Lock,
      title: "Direct & private",
      body: "Files travel browser-to-browser over an encrypted WebRTC channel. The server only introduces the peers.",
    },
    {
      Icon: HardDrive,
      title: "Any size",
      body: "Chunked with strict ACK backpressure and streamed to disk — multi-GB files stay off the heap.",
    },
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
      {/* Header */}
      <header className="mb-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-sky-500 text-white shadow-sm">
            <Share size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">MJShare</h1>
            <p className="text-sm text-[var(--text-subtle)]">Peer-to-peer file transfer</p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      <div className="space-y-5">
        <SecurityBanner />

        <RoomBar status={status} transport={transport} room={room} self={self} />

        <JoinLink code={code} onApplyCode={applyCode} />

        {/* Drop + Radar */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <DropZone
            key={dropKey}
            disabled={peers.length === 0}
            onFiles={setStaged}
          />
          <PeerRadar
            peers={peers}
            transfers={rtc.transfers}
            hasStagedFiles={staged.length > 0}
            onSelectPeer={handleSelectPeer}
          />
        </div>

        {/* Active transfers */}
        {active.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              In progress
            </h2>
            {active.map((t) => (
              <TransferCard
                key={t.id}
                transfer={t}
                onAccept={rtc.accept}
                onDecline={rtc.decline}
                onCancel={rtc.cancel}
                onRetry={rtc.retry}
                onDismiss={rtc.dismiss}
              />
            ))}
          </section>
        )}

        {/* History */}
        {history.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--text-subtle)]">
              History
            </h2>
            {history.map((t) => (
              <TransferCard
                key={t.id}
                transfer={t}
                onAccept={rtc.accept}
                onDecline={rtc.decline}
                onCancel={rtc.cancel}
                onRetry={rtc.retry}
                onDismiss={rtc.dismiss}
              />
            ))}
          </section>
        )}

        {/* How it works */}
        <footer className="grid grid-cols-1 gap-3 pt-4 sm:grid-cols-3">
          {features.map(({ Icon, title, body }) => (
            <div key={title} className="glass p-4">
              <Icon size={18} className="text-[var(--accent)]" />
              <p className="mt-2.5 text-sm font-medium text-[var(--text-2)]">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-subtle)]">{body}</p>
            </div>
          ))}
        </footer>

        {/* Credit */}
        <div className="flex items-center justify-center gap-1.5 pt-2 pb-1 text-xs text-[var(--text-subtle)]">
          <span>Built with</span>
          <Heart size={13} className="text-rose-400" aria-label="love" />
          <span>by</span>
          <a
            href="https://mujahidinfo.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring rounded-sm font-medium text-[var(--text-2)] underline decoration-slate-600 underline-offset-2 transition-colors hover:text-[var(--accent)] hover:decoration-brand-400"
          >
            Mujahid
          </a>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fade-up" aria-live="polite">
          <div className="glass flex items-center gap-2 px-4 py-2.5 text-sm text-[var(--text)]">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
            {toast}
          </div>
        </div>
      )}
    </main>
  );
}
