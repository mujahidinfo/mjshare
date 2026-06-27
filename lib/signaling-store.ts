import type { PeerInfo, SignalMessage } from "./types";

/**
 * In-memory signaling store.
 *
 * This is the entire "backend". It lives as a module-level singleton inside the
 * Next.js server process, so it requires NO external service (no Redis, no DB).
 * Each connected browser holds one open SSE stream; we keep a reference to that
 * stream's controller here so we can push messages to it.
 *
 * Trade-off: state is per-process and ephemeral. That is exactly what we want for
 * a zero-storage LAN tool — restart the server and everything is gone. For a
 * multi-instance deployment you would swap this for a shared pub/sub, but for the
 * "two devices on the same Wi-Fi" use case a single instance is ideal.
 *
 * We stash the singleton on `globalThis` so it survives Next.js dev hot-reloads.
 */

interface Connection {
  peer: PeerInfo;
  room: string;
  /** SSE controller used to enqueue messages to this specific browser. */
  send: (msg: SignalMessage) => void;
}

interface Store {
  /** peerId -> connection */
  connections: Map<string, Connection>;
  /** roomId -> set of peerIds */
  rooms: Map<string, Set<string>>;
}

const g = globalThis as unknown as { __mjshare?: Store };

const store: Store =
  g.__mjshare ??
  (g.__mjshare = {
    connections: new Map(),
    rooms: new Map(),
  });

function roomPeers(room: string): PeerInfo[] {
  const ids = store.rooms.get(room);
  if (!ids) return [];
  const peers: PeerInfo[] = [];
  for (const id of ids) {
    const c = store.connections.get(id);
    if (c) peers.push(c.peer);
  }
  return peers;
}

/** Broadcast a message to everyone in `room` except `exceptId`. */
function broadcast(room: string, msg: SignalMessage, exceptId?: string) {
  const ids = store.rooms.get(room);
  if (!ids) return;
  for (const id of ids) {
    if (id === exceptId) continue;
    store.connections.get(id)?.send(msg);
  }
}

export const Signaling = {
  /** Register a freshly opened SSE stream. Returns the assigned peer + roster. */
  join(
    peer: PeerInfo,
    room: string,
    send: (msg: SignalMessage) => void
  ): { peers: PeerInfo[] } {
    store.connections.set(peer.id, { peer, room, send });
    let set = store.rooms.get(room);
    if (!set) {
      set = new Set();
      store.rooms.set(room, set);
    }
    set.add(peer.id);

    // Tell the existing members that someone arrived.
    broadcast(room, { kind: "peer-joined", peer }, peer.id);

    return { peers: roomPeers(room).filter((p) => p.id !== peer.id) };
  },

  /** Tear down a stream (browser closed tab / network dropped). */
  leave(peerId: string) {
    const conn = store.connections.get(peerId);
    if (!conn) return;
    store.connections.delete(peerId);
    const set = store.rooms.get(conn.room);
    if (set) {
      set.delete(peerId);
      if (set.size === 0) store.rooms.delete(conn.room);
    }
    broadcast(conn.room, { kind: "peer-left", peerId });
  },

  /**
   * Relay a directed signal (offer/answer/ice/bye) to its target peer.
   * Returns false if the target is gone.
   */
  relay(msg: Extract<SignalMessage, { to: string }>): boolean {
    const target = store.connections.get(msg.to);
    if (!target) return false;
    target.send(msg);
    return true;
  },

  peers(room: string): PeerInfo[] {
    return roomPeers(room);
  },

  has(peerId: string): boolean {
    return store.connections.has(peerId);
  },
};
