"use client";

import { useCallback, useRef, useState } from "react";
import { formatBytes } from "@/lib/utils";
import { FileTypeIcon, UploadCloud, X } from "./icons";

interface DropZoneProps {
  /** Disabled until at least one peer is available to receive. */
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

/**
 * Glassmorphism drag-and-drop area. Accepts drop, click-to-browse, or paste.
 * Selected files are handed straight to the parent — nothing is read here, so
 * staging a 50 GB file costs nothing.
 */
export function DropZone({ disabled, onFiles }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [picked, setPicked] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const files = Array.from(list);
      setPicked(files);
      onFiles(files);
    },
    [onFiles]
  );

  const clear = () => {
    setPicked([]);
    onFiles([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && picked.length === 0 && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled && picked.length === 0) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="Add files to share"
      className={[
        "focus-ring group relative flex min-h-[15rem] flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed p-8 text-center transition-colors duration-200",
        disabled
          ? "cursor-not-allowed border-[var(--border)] bg-[var(--surface-2)] opacity-60"
          : picked.length > 0
            ? "cursor-default border-[var(--border)] bg-[var(--surface-2)]"
            : dragging
              ? "cursor-pointer border-brand-400/70 bg-brand-500/[0.06]"
              : "cursor-pointer border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--border-hover)] hover:bg-[var(--surface-2-hover)]",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />

      {picked.length === 0 ? (
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div
            className={[
              "flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--accent)] transition-transform duration-300",
              dragging ? "scale-110 text-[var(--accent)]" : "group-hover:-translate-y-0.5",
            ].join(" ")}
          >
            <UploadCloud size={24} />
          </div>
          <div className="space-y-1.5">
            <p className="text-base font-medium text-[var(--text)]">
              {disabled ? "Waiting for a nearby device" : "Drop files to share"}
            </p>
            <p className="mx-auto max-w-xs text-sm leading-relaxed text-[var(--text-muted)]">
              {disabled
                ? "Open mjshare on another device on the same network and it'll appear here."
                : "Drag & drop, click to browse, or paste. Files stream chunk-by-chunk — never loaded into memory."}
            </p>
          </div>
        </div>
      ) : (
        <div className="relative z-10 flex w-full max-w-md flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--accent)]">
              {picked.length} file{picked.length > 1 ? "s" : ""} staged · choose a device
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clear();
              }}
              className="focus-ring flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            >
              <X size={14} /> Clear
            </button>
          </div>
          <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-1 text-left">
            {picked.map((f, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <FileTypeIcon name={f.name} mime={f.type} size={18} className="shrink-0 text-[var(--text-muted)]" />
                  <span className="truncate text-[var(--text-2)]">{f.name}</span>
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--text-subtle)]">
                  {formatBytes(f.size)}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
            className="focus-ring self-start text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]"
          >
            + Add more
          </button>
        </div>
      )}
    </div>
  );
}
