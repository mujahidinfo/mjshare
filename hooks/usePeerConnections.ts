"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PeerManager } from "@/lib/PeerManager";
import type { PeerInfo, SignalMessage, Transfer } from "@/lib/types";

/**
 * React adapter around {@link PeerManager}. Owns the singleton manager for this
 * tab and exposes the live transfer list plus imperative actions.
 *
 * `sendSignal` is provided by the signaling hook and may change which transport
 * it routes over (socket.io vs SSE); we always read the latest via a ref so the
 * manager keeps signaling over the working channel.
 */
export function usePeerConnections(
  selfId: string,
  sendSignal: (msg: SignalMessage) => void
) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const managerRef = useRef<PeerManager | null>(null);

  const sendRef = useRef(sendSignal);
  sendRef.current = sendSignal;

  useEffect(() => {
    if (!selfId) return;
    const manager = new PeerManager(
      selfId,
      (msg) => sendRef.current(msg),
      {
        onTransfers: (list) => setTransfers([...list]),
        onIncomingOffer: () => {
          setNotice("Incoming file request");
          setTimeout(() => setNotice(null), 4000);
        },
        onNotice: (m) => {
          setNotice(m);
          setTimeout(() => setNotice(null), 4000);
        },
      }
    );
    managerRef.current = manager;
    return () => {
      manager.destroy();
      managerRef.current = null;
    };
  }, [selfId]);

  // Stable bridges consumed by the signaling hook.
  const handleSignal = useCallback((msg: SignalMessage) => {
    void managerRef.current?.handleSignal(msg);
  }, []);
  const setPeers = useCallback((peers: PeerInfo[]) => {
    managerRef.current?.setPeers(peers);
  }, []);

  const actions = useMemo(
    () => ({
      sendFile: (peerId: string, file: File) =>
        managerRef.current?.sendFile(peerId, file),
      accept: (id: string) => managerRef.current?.accept(id),
      decline: (id: string) => managerRef.current?.decline(id),
      cancel: (id: string) => managerRef.current?.cancel(id),
      retry: (id: string) => managerRef.current?.retry(id),
      dismiss: (id: string) => managerRef.current?.dismiss(id),
    }),
    []
  );

  return { transfers, notice, handleSignal, setPeers, ...actions };
}
