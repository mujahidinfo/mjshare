"use client";

import type { Transfer } from "@/lib/types";
import { formatBytes, formatEta, formatSpeed } from "@/lib/utils";
import { ArrowRight, Check, FileTypeIcon, RotateCw, X } from "./icons";

interface TransferCardProps {
  transfer: Transfer;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
}

const STATUS_META: Record<Transfer["status"], { label: string; cls: string }> = {
  pending: { label: "Awaiting", cls: "text-amber-700 dark:text-amber-300 bg-amber-400/[0.08] border-amber-400/25" },
  connecting: { label: "Connecting", cls: "text-sky-700 dark:text-sky-300 bg-sky-400/[0.08] border-sky-400/25" },
  transferring: { label: "Transferring", cls: "text-[var(--accent)] bg-brand-400/[0.08] border-brand-400/25" },
  completed: { label: "Completed", cls: "text-emerald-700 dark:text-emerald-300 bg-emerald-400/[0.08] border-emerald-400/25" },
  cancelled: { label: "Cancelled", cls: "text-[var(--text-muted)] bg-[var(--surface-2)] border-[var(--border)]" },
  error: { label: "Error", cls: "text-rose-700 dark:text-rose-300 bg-rose-400/[0.08] border-rose-400/25" },
};

const btnBase =
  "focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors";

export function TransferCard({
  transfer: t,
  onAccept,
  onDecline,
  onCancel,
  onRetry,
  onDismiss,
}: TransferCardProps) {
  const pct = t.fileSize > 0 ? Math.min(100, (t.transferred / t.fileSize) * 100) : 0;
  const status = STATUS_META[t.status];
  const isReceiveOffer = t.direction === "receive" && t.status === "pending";
  const isActive = t.status === "transferring" || t.status === "connecting";
  const isDone = t.status === "completed";
  const isFailed = t.status === "error";
  const isClosed = isDone || isFailed || t.status === "cancelled";

  return (
    <article className="glass animate-fade-up p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--input-bg)] text-[var(--text-muted)]">
          <FileTypeIcon name={t.fileName} mime={t.fileType} size={20} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--text)]">{t.fileName}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--text-subtle)]">
                <span className="inline-flex items-center gap-1">
                  {t.direction === "send" ? "To" : "From"}
                  <ArrowRight
                    size={12}
                    className={t.direction === "send" ? "" : "rotate-180"}
                  />
                </span>
                <span className="text-[var(--text-muted)]">{t.peerName}</span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{formatBytes(t.fileSize)}</span>
                {t.direction === "receive" && t.sink === "memory" && (
                  <span className="text-amber-700 dark:text-amber-400/80">· RAM</span>
                )}
                {t.direction === "receive" && t.sink === "disk" && (
                  <span className="text-emerald-700 dark:text-emerald-400/80">· to disk</span>
                )}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${status.cls}`}
            >
              {status.label}
            </span>
          </div>

          {/* Progress */}
          <div className="mt-3">
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
              role="progressbar"
              aria-valuenow={Math.round(isDone ? 100 : pct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={[
                  "h-full rounded-full transition-[width] duration-200 ease-out",
                  isDone
                    ? "bg-emerald-400"
                    : isFailed
                      ? "bg-rose-400/70"
                      : "progress-fill",
                ].join(" ")}
                style={{ width: `${isDone ? 100 : pct}%` }}
              />
            </div>

            <div className="mt-2 flex items-center justify-between text-xs text-[var(--text-subtle)]">
              <span className="font-mono tabular-nums">
                {formatBytes(t.transferred)} / {formatBytes(t.fileSize)} ·{" "}
                {(isDone ? 100 : pct).toFixed(0)}%
              </span>
              {isActive && (
                <span className="flex items-center gap-3 font-mono tabular-nums">
                  <span className="text-[var(--accent)]">{formatSpeed(t.speed)}</span>
                  <span>ETA {formatEta(t.eta)}</span>
                </span>
              )}
            </div>
          </div>

          {t.error && <p className="mt-2 text-xs text-rose-700 dark:text-rose-300/90">{t.error}</p>}

          {/* Actions */}
          <div className="mt-3 flex flex-wrap gap-2">
            {isReceiveOffer && (
              <>
                <button
                  onClick={() => onAccept(t.id)}
                  className={`${btnBase} bg-brand-600 text-white hover:bg-brand-500`}
                >
                  <Check size={14} /> Accept & save
                </button>
                <button
                  onClick={() => onDecline(t.id)}
                  className={`${btnBase} border border-[var(--border)] text-[var(--text-2)] hover:bg-[var(--surface-2-hover)]`}
                >
                  Decline
                </button>
              </>
            )}

            {isActive && (
              <button
                onClick={() => onCancel(t.id)}
                className={`${btnBase} border border-[var(--border)] text-[var(--text-2)] hover:bg-rose-500/15 hover:text-rose-700 dark:hover:text-rose-200`}
              >
                <X size={14} /> Cancel
              </button>
            )}

            {isFailed && t.direction === "send" && (
              <button
                onClick={() => onRetry(t.id)}
                className={`${btnBase} bg-brand-600 text-white hover:bg-brand-500`}
              >
                <RotateCw size={14} /> Retry
              </button>
            )}

            {isClosed && (
              <button
                onClick={() => onDismiss(t.id)}
                className={`${btnBase} border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2-hover)]`}
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
