import {
  ACK,
  type DataControl,
  type PeerInfo,
  type SignalMessage,
  type Transfer,
} from "./types";
import { supportsFileSystemAccess, uid } from "./utils";

/**
 * PeerManager — the WebRTC + file-transfer engine.
 *
 * Framework agnostic on purpose: it knows nothing about React. It takes a way to
 * send signaling messages, exposes methods (sendFile / accept / decline / cancel /
 * retry) and reports state back through callbacks. `usePeerConnections` adapts it
 * to React.
 *
 * Design highlights:
 *  - ONE RTCPeerConnection per peer, reused across transfers.
 *  - Only the file *sender* ever creates an SDP offer, so there is no glare and we
 *    don't need full "perfect negotiation".
 *  - Strict ACK backpressure: the sender ships exactly one chunk, then blocks until
 *    the receiver writes it and replies "ACK". At most one chunk is ever in flight,
 *    so the WebRTC send buffer can never overflow and RAM stays flat.
 *  - The receiver streams chunks straight to disk via the File System Access API
 *    when available, falling back to an in-RAM Blob only when it isn't.
 */

const CHUNK_SIZE = 64 * 1024; // 64 KB — comfortably under the SCTP message limit

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

type Sink = "disk" | "memory";

interface OutgoingState {
  transferId: string;
  file: File;
  cancelled: boolean;
  ackResolve?: () => void;
  ackReject?: (e: Error) => void;
}

interface IncomingState {
  transferId: string;
  meta: Extract<DataControl, { t: "meta" }>;
  sink?: Sink;
  writer?: FileSystemWritableFileStream;
  chunks?: ArrayBuffer[];
  received: number;
}

interface Conn {
  peerId: string;
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  remoteSet: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  outgoing?: OutgoingState;
  incoming?: IncomingState;
}

interface SpeedMeta {
  lastTime: number;
  lastBytes: number;
  ema: number; // smoothed bytes/sec
}

export interface PeerManagerCallbacks {
  /** Called (throttled) whenever the transfer list changes. */
  onTransfers: (transfers: Transfer[]) => void;
  /** Fired when a new incoming file offer needs the user's accept/decline. */
  onIncomingOffer?: (transfer: Transfer) => void;
  /** Non-fatal user-facing notice. */
  onNotice?: (msg: string) => void;
}

export class PeerManager {
  private conns = new Map<string, Conn>();
  private transfers = new Map<string, Transfer>();
  private speed = new Map<string, SpeedMeta>();
  private names = new Map<string, string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private selfId: string,
    private sendSignal: (msg: SignalMessage) => void,
    private cb: PeerManagerCallbacks
  ) {}

  // ---- roster -------------------------------------------------------------

  setPeers(peers: PeerInfo[]) {
    for (const p of peers) this.names.set(p.id, p.name);
  }

  peerName(id: string): string {
    return this.names.get(id) ?? "Unknown device";
  }

  // ---- public API ---------------------------------------------------------

  /** Begin sending a file to a peer. Resolves once the offer has been dispatched. */
  async sendFile(peerId: string, file: File) {
    const conn = this.ensureConnection(peerId, true);
    const transferId = uid("tx");

    const transfer: Transfer = {
      id: transferId,
      peerId,
      peerName: this.peerName(peerId),
      direction: "send",
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || "application/octet-stream",
      transferred: 0,
      status: "connecting",
      speed: 0,
      eta: Infinity,
    };
    this.transfers.set(transferId, transfer);
    this.emit(true);

    conn.outgoing = { transferId, file, cancelled: false };

    // Wait until the data channel is actually open, then announce the file.
    await this.whenChannelOpen(conn);
    if (conn.outgoing.cancelled) return;
    this.sendControl(conn, {
      t: "meta",
      id: transferId,
      name: file.name,
      size: file.size,
      mime: transfer.fileType,
    });
    this.patch(transferId, { status: "pending" }); // awaiting receiver accept
  }

  /**
   * Receiver accepts an incoming file. MUST be called from a user gesture so the
   * File System Access save dialog is allowed to open.
   */
  async accept(transferId: string) {
    const conn = this.connForTransfer(transferId);
    const inc = conn?.incoming;
    if (!conn || !inc || inc.transferId !== transferId) return;

    let sink: Sink = "memory";
    if (supportsFileSystemAccess()) {
      try {
        const handle = await window.showSaveFilePicker!({
          suggestedName: inc.meta.name,
        });
        inc.writer = await handle.createWritable();
        sink = "disk";
      } catch (err) {
        // User dismissed the picker => treat as decline.
        if ((err as DOMException)?.name === "AbortError") {
          this.decline(transferId);
          return;
        }
        // Any other failure: fall back to buffering in RAM.
        inc.chunks = [];
        sink = "memory";
      }
    } else {
      inc.chunks = [];
      sink = "memory";
    }

    inc.sink = sink;
    this.patch(transferId, { status: "transferring", sink });
    this.sendControl(conn, { t: "meta-ack", id: transferId });
  }

  decline(transferId: string) {
    const conn = this.connForTransfer(transferId);
    if (conn) this.sendControl(conn, { t: "meta-decline", id: transferId });
    this.patch(transferId, { status: "cancelled", error: "Declined" });
    if (conn) conn.incoming = undefined;
  }

  cancel(transferId: string) {
    const conn = this.connForTransfer(transferId);
    const t = this.transfers.get(transferId);
    if (!conn || !t) return;
    this.sendControl(conn, { t: "cancel", id: transferId });
    if (conn.outgoing?.transferId === transferId) {
      conn.outgoing.cancelled = true;
      conn.outgoing.ackReject?.(new Error("cancelled"));
    }
    if (conn.incoming?.transferId === transferId) {
      void conn.incoming.writer?.close().catch(() => {});
      conn.incoming = undefined;
    }
    this.patch(transferId, { status: "cancelled" });
  }

  /** Retry a failed *outgoing* transfer (receiver-side retries aren't possible). */
  async retry(transferId: string) {
    const t = this.transfers.get(transferId);
    if (!t || t.direction !== "send") return;
    const conn = this.conns.get(t.peerId);
    const file = conn?.outgoing?.file;
    if (!file) return;
    // Drop the (likely broken) connection and start fresh.
    this.teardown(t.peerId);
    this.transfers.delete(transferId);
    this.speed.delete(transferId);
    this.emit(true);
    await this.sendFile(t.peerId, file);
  }

  /** Forget a finished/cancelled transfer card. */
  dismiss(transferId: string) {
    this.transfers.delete(transferId);
    this.speed.delete(transferId);
    this.emit(true);
  }

  // ---- signaling intake ---------------------------------------------------

  async handleSignal(msg: SignalMessage) {
    switch (msg.kind) {
      case "offer": {
        const conn = this.ensureConnection(msg.from, false);
        await conn.pc.setRemoteDescription(msg.sdp);
        conn.remoteSet = true;
        await this.drainCandidates(conn);
        const answer = await conn.pc.createAnswer();
        await conn.pc.setLocalDescription(answer);
        this.sendSignal({
          kind: "answer",
          from: this.selfId,
          to: msg.from,
          sdp: conn.pc.localDescription!,
        });
        break;
      }
      case "answer": {
        const conn = this.conns.get(msg.from);
        if (!conn) return;
        await conn.pc.setRemoteDescription(msg.sdp);
        conn.remoteSet = true;
        await this.drainCandidates(conn);
        break;
      }
      case "ice": {
        const conn = this.conns.get(msg.from);
        if (!conn) return;
        if (conn.remoteSet) {
          try {
            await conn.pc.addIceCandidate(msg.candidate);
          } catch {
            /* benign during teardown */
          }
        } else {
          conn.pendingCandidates.push(msg.candidate);
        }
        break;
      }
    }
  }

  /** Tear everything down (e.g. on unmount). */
  destroy() {
    for (const id of Array.from(this.conns.keys())) this.teardown(id);
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }

  // ---- connection lifecycle ----------------------------------------------

  private ensureConnection(peerId: string, asInitiator: boolean): Conn {
    let conn = this.conns.get(peerId);
    if (conn) return conn;

    const pc = new RTCPeerConnection(ICE_CONFIG);
    conn = {
      peerId,
      pc,
      remoteSet: false,
      pendingCandidates: [],
    };
    this.conns.set(peerId, conn);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal({
          kind: "ice",
          from: this.selfId,
          to: peerId,
          candidate: e.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "failed" || st === "disconnected" || st === "closed") {
        this.failActive(conn!, "Connection lost");
      }
    };

    if (asInitiator) {
      const channel = pc.createDataChannel("mjshare", { ordered: true });
      this.setupChannel(conn, channel);
      // createDataChannel triggers negotiationneeded -> create the offer.
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.sendSignal({
            kind: "offer",
            from: this.selfId,
            to: peerId,
            sdp: pc.localDescription!,
          });
        } catch {
          this.failActive(conn!, "Failed to negotiate connection");
        }
      };
    } else {
      pc.ondatachannel = (e) => this.setupChannel(conn!, e.channel);
    }

    return conn;
  }

  private setupChannel(conn: Conn, channel: RTCDataChannel) {
    channel.binaryType = "arraybuffer";
    conn.channel = channel;

    channel.onmessage = (e) => {
      if (typeof e.data === "string") this.onControl(conn, e.data);
      else void this.onBinary(conn, e.data as ArrayBuffer);
    };
    channel.onclose = () => this.failActive(conn, "Channel closed");
    channel.onerror = () => this.failActive(conn, "Channel error");
  }

  private whenChannelOpen(conn: Conn): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ch = conn.channel;
      if (ch && ch.readyState === "open") return resolve();
      if (!ch) return reject(new Error("no channel"));
      const onOpen = () => {
        ch.removeEventListener("open", onOpen);
        resolve();
      };
      ch.addEventListener("open", onOpen);
      // Safety timeout so a stuck connection surfaces as an error.
      setTimeout(() => {
        if (ch.readyState !== "open") {
          ch.removeEventListener("open", onOpen);
          reject(new Error("channel open timeout"));
        }
      }, 20000);
    }).catch((e) => {
      if (conn.outgoing) this.failActive(conn, "Could not open data channel");
      throw e;
    });
  }

  // ---- control-frame handling --------------------------------------------

  private onControl(conn: Conn, raw: string) {
    if (raw === ACK) {
      conn.outgoing?.ackResolve?.();
      return;
    }
    let ctrl: DataControl;
    try {
      ctrl = JSON.parse(raw) as DataControl;
    } catch {
      return;
    }

    switch (ctrl.t) {
      case "meta": {
        // Incoming file offer (receiver side).
        const inc: IncomingState = { transferId: ctrl.id, meta: ctrl, received: 0 };
        conn.incoming = inc;
        const transfer: Transfer = {
          id: ctrl.id,
          peerId: conn.peerId,
          peerName: this.peerName(conn.peerId),
          direction: "receive",
          fileName: ctrl.name,
          fileSize: ctrl.size,
          fileType: ctrl.mime,
          transferred: 0,
          status: "pending",
          speed: 0,
          eta: Infinity,
        };
        this.transfers.set(ctrl.id, transfer);
        this.emit(true);
        this.cb.onIncomingOffer?.(transfer);
        break;
      }
      case "meta-ack": {
        // Receiver accepted — start pushing chunks (sender side).
        this.patch(ctrl.id, { status: "transferring" });
        void this.runSend(conn, ctrl.id);
        break;
      }
      case "meta-decline": {
        if (conn.outgoing) conn.outgoing.cancelled = true;
        this.patch(ctrl.id, { status: "cancelled", error: "Receiver declined" });
        break;
      }
      case "done": {
        void this.finishReceive(conn, ctrl.id);
        break;
      }
      case "cancel": {
        // The other side aborted.
        if (conn.incoming?.transferId === ctrl.id) {
          void conn.incoming.writer?.close().catch(() => {});
          conn.incoming = undefined;
        }
        if (conn.outgoing?.transferId === ctrl.id) {
          conn.outgoing.cancelled = true;
          conn.outgoing.ackReject?.(new Error("cancelled"));
        }
        this.patch(ctrl.id, { status: "cancelled", error: "Cancelled by peer" });
        break;
      }
    }
  }

  // ---- sending ------------------------------------------------------------

  private async runSend(conn: Conn, transferId: string) {
    const out = conn.outgoing;
    if (!out || out.transferId !== transferId) return;
    const file = out.file;
    let offset = 0;

    try {
      while (offset < file.size) {
        if (out.cancelled) return;
        const end = Math.min(offset + CHUNK_SIZE, file.size);
        // Blob.slice is lazy: this reads ONLY this chunk off disk, never the whole file.
        const buf = await file.slice(offset, end).arrayBuffer();

        // Arm the ACK gate BEFORE sending so we can't miss the reply.
        const ack = new Promise<void>((resolve, reject) => {
          out.ackResolve = resolve;
          out.ackReject = reject;
        });
        conn.channel!.send(buf);
        await ack; // strict backpressure: block until the receiver confirms

        offset = end;
        this.progress(transferId, offset);
      }
      if (out.cancelled) return;
      this.sendControl(conn, { t: "done", id: transferId });
      this.patch(transferId, { status: "completed", transferred: file.size });
    } catch (err) {
      if (!out.cancelled) {
        this.patch(transferId, {
          status: "error",
          error: (err as Error)?.message || "Transfer failed",
        });
      }
    }
  }

  // ---- receiving ----------------------------------------------------------

  private async onBinary(conn: Conn, data: ArrayBuffer) {
    const inc = conn.incoming;
    if (!inc) return;
    try {
      if (inc.sink === "disk" && inc.writer) {
        await inc.writer.write(new Uint8Array(data));
      } else if (inc.chunks) {
        inc.chunks.push(data);
      }
      inc.received += data.byteLength;
      this.progress(inc.transferId, inc.received);
      // Only ACK *after* the chunk is durably handled — this is what makes the
      // sender's pace track real disk throughput.
      conn.channel!.send(ACK);
    } catch (err) {
      this.patch(inc.transferId, {
        status: "error",
        error: "Failed to write chunk: " + (err as Error)?.message,
      });
      this.sendControl(conn, { t: "cancel", id: inc.transferId });
      conn.incoming = undefined;
    }
  }

  private async finishReceive(conn: Conn, transferId: string) {
    const inc = conn.incoming;
    if (!inc || inc.transferId !== transferId) return;
    try {
      if (inc.sink === "disk" && inc.writer) {
        await inc.writer.close();
      } else if (inc.chunks) {
        // RAM fallback: assemble the Blob and trigger a normal browser download.
        const blob = new Blob(inc.chunks, {
          type: inc.meta.mime || "application/octet-stream",
        });
        this.triggerDownload(blob, inc.meta.name);
      }
      this.patch(transferId, { status: "completed", transferred: inc.received });
    } catch (err) {
      this.patch(transferId, {
        status: "error",
        error: "Failed to finalize file: " + (err as Error)?.message,
      });
    } finally {
      conn.incoming = undefined;
    }
  }

  private triggerDownload(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---- helpers ------------------------------------------------------------

  private sendControl(conn: Conn, ctrl: DataControl) {
    if (conn.channel?.readyState === "open") {
      conn.channel.send(JSON.stringify(ctrl));
    }
  }

  private async drainCandidates(conn: Conn) {
    const pending = conn.pendingCandidates;
    conn.pendingCandidates = [];
    for (const c of pending) {
      try {
        await conn.pc.addIceCandidate(c);
      } catch {
        /* ignore */
      }
    }
  }

  private connForTransfer(transferId: string): Conn | undefined {
    for (const conn of this.conns.values()) {
      if (
        conn.incoming?.transferId === transferId ||
        conn.outgoing?.transferId === transferId
      ) {
        return conn;
      }
    }
    // Fall back to the peer recorded on the transfer.
    const t = this.transfers.get(transferId);
    return t ? this.conns.get(t.peerId) : undefined;
  }

  private failActive(conn: Conn, reason: string) {
    for (const t of this.transfers.values()) {
      if (
        t.peerId === conn.peerId &&
        (t.status === "transferring" || t.status === "connecting" || t.status === "pending")
      ) {
        this.patch(t.id, { status: "error", error: reason });
      }
    }
    conn.outgoing?.ackReject?.(new Error(reason));
  }

  private teardown(peerId: string) {
    const conn = this.conns.get(peerId);
    if (!conn) return;
    try {
      conn.channel?.close();
    } catch {
      /* ignore */
    }
    try {
      conn.pc.close();
    } catch {
      /* ignore */
    }
    this.conns.delete(peerId);
  }

  /** Update progress + recompute smoothed speed and ETA. */
  private progress(transferId: string, transferred: number) {
    const t = this.transfers.get(transferId);
    if (!t) return;
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    let meta = this.speed.get(transferId);
    if (!meta) {
      meta = { lastTime: now, lastBytes: transferred, ema: 0 };
      this.speed.set(transferId, meta);
    }
    const dt = (now - meta.lastTime) / 1000;
    if (dt >= 0.25) {
      const inst = Math.max(0, (transferred - meta.lastBytes) / dt);
      meta.ema = meta.ema ? meta.ema * 0.7 + inst * 0.3 : inst;
      meta.lastTime = now;
      meta.lastBytes = transferred;
    }
    t.transferred = transferred;
    t.speed = meta.ema;
    t.eta = meta.ema > 0 ? (t.fileSize - transferred) / meta.ema : Infinity;
    this.emit(false);
  }

  private patch(transferId: string, changes: Partial<Transfer>) {
    const t = this.transfers.get(transferId);
    if (!t) return;
    Object.assign(t, changes);
    this.emit(true);
  }

  /**
   * Push the transfer list to React. Status changes flush immediately; pure
   * progress ticks are throttled (~12/s) so a multi-GB transfer doesn't drown
   * React in renders.
   */
  private emit(immediate: boolean) {
    if (immediate) {
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.cb.onTransfers(Array.from(this.transfers.values()));
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.cb.onTransfers(Array.from(this.transfers.values()));
    }, 80);
  }
}
