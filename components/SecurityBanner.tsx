"use client";

import { useEffect, useState } from "react";
import { isSecureForWebRTC, supportsFileSystemAccess } from "@/lib/utils";
import { ShieldAlert, TriangleAlert } from "./icons";

/**
 * Surfaces the two environmental requirements that silently break P2P transfer:
 *   1. A secure context (HTTPS or localhost) — WebRTC refuses to run otherwise.
 *   2. The File System Access API — without it large files buffer in RAM.
 */
export function SecurityBanner() {
  const [secure, setSecure] = useState(true);
  const [fsa, setFsa] = useState(true);

  useEffect(() => {
    setSecure(isSecureForWebRTC());
    setFsa(supportsFileSystemAccess());
  }, []);

  if (secure && fsa) return null;

  return (
    <div className="space-y-3" role="alert" aria-live="polite">
      {!secure && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/[0.07] px-4 py-3 text-sm text-rose-800 dark:text-rose-100">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-rose-700 dark:text-rose-300" />
          <div>
            <p className="font-medium">Insecure context — WebRTC is disabled</p>
            <p className="mt-1 leading-relaxed text-rose-700 dark:text-rose-200/75">
              Browsers only allow peer connections over{" "}
              <code className="rounded bg-[var(--input-bg)] px-1 font-mono text-[0.8em]">https://</code>{" "}
              or{" "}
              <code className="rounded bg-[var(--input-bg)] px-1 font-mono text-[0.8em]">localhost</code>.
              To share across devices, serve over HTTPS and open by hostname — plain{" "}
              <code className="rounded bg-[var(--input-bg)] px-1 font-mono text-[0.8em]">http://192.168.x.x</code>{" "}
              will block P2P.
            </p>
          </div>
        </div>
      )}
      {secure && !fsa && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-800 dark:text-amber-100">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
          <div>
            <p className="font-medium">Large-file streaming limited in this browser</p>
            <p className="mt-1 leading-relaxed text-amber-700 dark:text-amber-200/75">
              The File System Access API is unavailable, so received files buffer in RAM
              before download — very large files may crash the tab. For unlimited sizes,
              use Chrome or Edge on desktop.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
