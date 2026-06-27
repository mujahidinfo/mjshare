"use client";

import { useState } from "react";
import { uid } from "@/lib/utils";

/**
 * A stable per-tab peer id. Persisted in sessionStorage so a hot-reload or a
 * transient SSE reconnect keeps the same identity (and therefore the same room
 * membership), but a brand-new tab is a brand-new peer.
 */
export function usePeerId(): string {
  const [id] = useState(() => {
    if (typeof window === "undefined") return uid("peer");
    const key = "mjshare:peerId";
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const fresh = uid("peer");
    window.sessionStorage.setItem(key, fresh);
    return fresh;
  });
  return id;
}
