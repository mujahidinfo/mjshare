/**
 * Shared types used across the signaling layer (server) and the WebRTC layer (client).
 *
 * The vocabulary is intentionally small:
 *  - "Signal" messages travel over the HTTP signaling channel (SSE + POST) and are
 *    only used to bootstrap a peer-to-peer connection (SDP + ICE exchange).
 *  - Once the RTCDataChannel is open, ALL file bytes flow peer-to-peer and never
 *    touch the server.
 */

/** A peer as advertised to others inside a room. */
export interface PeerInfo {
  id: string;
  name: string;
  joinedAt: number;
}

/** Message envelope exchanged over the HTTP signaling channel. */
export type SignalMessage =
  // server -> client: sent immediately after the SSE stream opens
  | {
      kind: "welcome";
      self: PeerInfo;
      room: string;
      peers: PeerInfo[];
    }
  // server -> client: roster changes
  | { kind: "peer-joined"; peer: PeerInfo }
  | { kind: "peer-left"; peerId: string }
  // client -> server -> client: WebRTC negotiation, relayed verbatim
  | {
      kind: "offer";
      from: string;
      to: string;
      sdp: RTCSessionDescriptionInit;
    }
  | {
      kind: "answer";
      from: string;
      to: string;
      sdp: RTCSessionDescriptionInit;
    }
  | {
      kind: "ice";
      from: string;
      to: string;
      candidate: RTCIceCandidateInit;
    }
  // client -> server -> client: lightweight "I want to send you a file" nudge,
  // used so the receiver UI can react even before SDP is exchanged.
  | { kind: "bye"; from: string; to: string };

/** Control frames sent over the RTCDataChannel itself (as JSON strings). */
export type DataControl =
  | {
      t: "meta";
      id: string;
      name: string;
      size: number;
      mime: string;
    }
  | { t: "meta-ack"; id: string }
  | { t: "meta-decline"; id: string }
  | { t: "done"; id: string }
  | { t: "cancel"; id: string; reason?: string };

/** The literal byte-level acknowledgement string (see backpressure protocol). */
export const ACK = "ACK";

export type TransferStatus =
  | "pending" // receiver: awaiting user accept | sender: awaiting receiver accept
  | "connecting"
  | "transferring"
  | "completed"
  | "cancelled"
  | "error";

export type TransferDirection = "send" | "receive";

/** UI-facing view of a single file transfer. */
export interface Transfer {
  id: string;
  peerId: string;
  peerName: string;
  direction: TransferDirection;
  fileName: string;
  fileSize: number;
  fileType: string;
  transferred: number;
  status: TransferStatus;
  speed: number; // bytes / second (smoothed)
  eta: number; // seconds remaining (Infinity when unknown)
  error?: string;
  /** Receiver-only: whether bytes are streamed to disk vs buffered in RAM. */
  sink?: "disk" | "memory";
}
