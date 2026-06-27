"use client";

import { useEffect, useMemo, useState } from "react";
import { randomCode } from "@/lib/utils";
import { Check, Copy, Link as LinkIcon } from "./icons";

interface JoinLinkProps {
  /** Active manual room code ("" = automatic discovery). */
  code: string;
  onApplyCode: (code: string) => void;
}

/**
 * Invite panel: generate a shareable join link for a private room, copy it, or
 * join an existing room by code. Opening a link with `?room=CODE` auto-joins that
 * room (handled on the page).
 */
export function JoinLink({ code, onApplyCode }: JoinLinkProps) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const link = useMemo(
    () => (code && origin ? `${origin}/?room=${code}` : ""),
    [code, origin]
  );

  const generate = () => onApplyCode(randomCode());

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Fallback for non-secure contexts where the Clipboard API is blocked.
      const el = document.createElement("textarea");
      el.value = link;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section className="glass p-5 sm:p-6">
      <div className="flex items-center gap-2.5">
        <LinkIcon size={18} className="text-[var(--accent)]" />
        <div>
          <h2 className="text-sm font-medium text-[var(--text-2)]">Invite a device</h2>
          <p className="text-xs text-[var(--text-subtle)]">
            {code
              ? "Anyone with this link joins your private room."
              : "On the same Wi-Fi, devices connect automatically — or create a private room link."}
          </p>
        </div>
      </div>

      {code ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <label htmlFor="join-link" className="sr-only">
              Shareable join link
            </label>
            <input
              id="join-link"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="focus-ring min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-xs text-[var(--text-2)]"
            />
            <button
              type="button"
              onClick={copy}
              className="focus-ring inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-500"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-xs text-[var(--text-subtle)]">Room code</span>
              <span className="font-mono text-base font-semibold tracking-[0.2em] text-[var(--accent)]">
                {code}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onApplyCode("")}
              className="focus-ring cursor-pointer rounded-md px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            >
              Back to auto
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={generate}
            className="focus-ring inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-500"
          >
            <LinkIcon size={16} /> Create join link
          </button>

          <span className="text-xs text-[var(--text-subtle)] sm:px-1">or</span>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const c = draft.trim().toUpperCase();
              if (c) onApplyCode(c);
            }}
            className="flex items-center gap-2"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.toUpperCase())}
              placeholder="Enter code"
              maxLength={12}
              aria-label="Join with a room code"
              className="focus-ring w-32 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 font-mono text-sm uppercase tracking-wider placeholder:text-[var(--text-subtle)]"
            />
            <button
              type="submit"
              className="focus-ring cursor-pointer rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--text-2)] transition-colors hover:bg-[var(--surface-2-hover)]"
            >
              Join
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
