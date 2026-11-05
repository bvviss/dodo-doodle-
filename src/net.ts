// WebSocket client: connects to a room, reconnects with the saved token
// (exponential backoff), keeps a clock offset to the server, and holds the
// latest game state for React (via useSyncExternalStore).

import { useSyncExternalStore } from "react";
import type { ClientMsg, ErrorCode, PublicRoom, ServerMsg, Step, Task } from "../shared/types";
import { wsUrl } from "./server";
import { storage } from "./storage";

export type Status = "idle" | "connecting" | "open" | "reconnecting";

export interface FloatingReaction {
  id: number;
  emoji: string;
  playerId: string;
  x: number;
}

export interface CachedChain {
  ownerId: string;
  steps: Step[];
}

export interface ClientState {
  status: Status;
  code: string | null;
  playerId: string | null;
  room: PublicRoom | null;
  task: Task | null;
  taskSeq: number;
  submitted: boolean;
  /** serverTime ≈ Date.now() + offset */
  offset: number;
  chains: Record<number, CachedChain>;
  reactions: FloatingReaction[];
  /** Short-lived message from the server. */
  toast: string | null;
  /** The room refused us (game in progress, full, kicked): stop trying. */
  fatal: { message: string; code?: ErrorCode } | null;
}

const initial: ClientState = {
  status: "idle",
  code: null,
  playerId: null,
  room: null,
  task: null,
  taskSeq: -1,
  submitted: false,
  offset: 0,
  chains: {},
  reactions: [],
  toast: null,
  fatal: null,
};

class GameClient {
  private state: ClientState = initial;
  private listeners = new Set<() => void>();
  private ws: WebSocket | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private bestRtt = Infinity;
  private wanted: { code: string; name: string; colour: string } | null = null;
  private reactionId = 0;

  // ---------------- store plumbing
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;
  private set(patch: Partial<ClientState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Current server time in ms. */
  serverNow(): number {
    return Date.now() + this.state.offset;
  }

  // ---------------- connection
  join(code: string, name: string, colour: string) {
    this.wanted = { code, name, colour };
    this.attempts = 0;
    this.bestRtt = Infinity;
    if (this.state.code !== code) {
      this.set({ ...initial, code, status: "connecting" });
    } else {
      this.set({ fatal: null, status: "connecting" });
    }
    this.open();
  }

  leave() {
    this.wanted = null;
    this.pending = [];
    storage.setSession(null);
    this.teardown();
    this.set({ ...initial });
  }

  private teardown() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }

  private open() {
    this.teardown();
    const w = this.wanted;
    if (!w) return;
    const ws = new WebSocket(wsUrl(`/api/room/${w.code}/ws`));
    this.ws = ws;

    ws.onopen = () => {
      const session = storage.session();
      const token = session && session.code === w.code ? session.token : undefined;
      this.sendRaw({ type: "join", name: w.name, colour: w.colour, token });
      this.ping();
      this.pingTimer = setInterval(() => this.ping(), 15_000);
    };
    ws.onmessage = (ev) => {
      try {
        this.onMessage(JSON.parse(ev.data as string) as ServerMsg);
      } catch (err) {
        console.error(err);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (!this.wanted || this.state.fatal) {
        this.set({ status: "idle" });
        return;
      }
      this.set({ status: "reconnecting" });
      const delay = Math.min(10_000, 500 * 2 ** this.attempts) * (0.75 + Math.random() * 0.5);
      this.attempts++;
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
  }

  private ping() {
    this.sendRaw({ type: "ping", t: Date.now() });
  }

  private sendRaw(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Messages that must not be lost while reconnecting (sent after the next welcome). */
  private pending: { msg: ClientMsg; seq: number }[] = [];
  private flushOnState = false;

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.state.status === "open") {
      this.ws.send(JSON.stringify(msg));
    } else if (msg.type === "submit" || msg.type === "autosave") {
      // Remember it for the same task only.
      this.pending = [...this.pending.filter((p) => p.msg.type !== msg.type), { msg, seq: this.state.taskSeq }];
    }
  }

  /** Called when the page becomes visible again (phones pause sockets in the background). */
  wake() {
    if (this.wanted && !this.ws && this.state.status === "reconnecting") {
      this.attempts = 0;
      this.open();
    }
  }

  // ---------------- incoming
  private onMessage(msg: ServerMsg) {
    switch (msg.type) {
      case "welcome":
        this.attempts = 0;
        if (this.wanted) storage.setSession({ code: this.wanted.code, token: msg.token });
        this.set({ playerId: msg.playerId, status: "open", fatal: null });
        this.flushOnState = true;
        return;

      case "state": {
        const prev = this.state.room;
        const patch: Partial<ClientState> = { room: msg.room, submitted: msg.you.submitted, taskSeq: msg.you.taskSeq, status: "open" };
        if (msg.you.task !== undefined) patch.task = msg.you.task;
        if (this.bestRtt === Infinity) patch.offset = msg.serverNow - Date.now();
        // New game: forget old chains.
        if (msg.room.phase === "lobby" || (msg.room.phase === "prompt" && prev?.phase !== "prompt")) patch.chains = {};
        this.set(patch);
        if (this.flushOnState) {
          this.flushOnState = false;
          // Only resend answers for the task that is still current.
          for (const p of this.pending.splice(0)) if (p.seq === msg.you.taskSeq && !msg.you.submitted) this.sendRaw(p.msg);
        }
        return;
      }

      case "pong": {
        const now = Date.now();
        const rtt = now - msg.t;
        if (rtt <= this.bestRtt) {
          this.bestRtt = rtt;
          this.set({ offset: msg.serverNow + rtt / 2 - now });
        }
        return;
      }

      case "revealData":
      case "chain": {
        const old = this.state.chains[msg.chainIndex];
        const steps = msg.type === "chain" ? [...msg.steps] : [...(old?.steps ?? [])];
        if (msg.type === "revealData") msg.steps.forEach((s, i) => (steps[msg.fromStep + i] = s));
        this.set({ chains: { ...this.state.chains, [msg.chainIndex]: { ownerId: msg.ownerId, steps } } });
        return;
      }

      case "reaction": {
        const r: FloatingReaction = { id: ++this.reactionId, emoji: msg.emoji, playerId: msg.playerId, x: 8 + Math.random() * 84 };
        this.set({ reactions: [...this.state.reactions, r].slice(-30) });
        setTimeout(() => this.set({ reactions: this.state.reactions.filter((x) => x.id !== r.id) }), 2600);
        return;
      }

      case "error":
        if (msg.code === "in_progress" || msg.code === "full" || msg.code === "kicked") {
          if (msg.code === "kicked") storage.setSession(null);
          this.wanted = null;
          this.set({ fatal: { message: msg.message, code: msg.code }, status: "idle", room: null });
          this.teardown();
          return;
        }
        this.showToast(msg.message);
        return;
    }
  }

  showToast(message: string) {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.set({ toast: message });
    this.toastTimer = setTimeout(() => this.set({ toast: null }), 4000);
  }
}

export const client = new GameClient();

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") client.wake();
  });
  window.addEventListener("online", () => client.wake());
}

export function useGame(): ClientState {
  return useSyncExternalStore(client.subscribe, client.getSnapshot);
}

/** Room + me helpers. */
export function useMe() {
  const s = useGame();
  const me = s.room?.players.find((p) => p.id === s.playerId) ?? null;
  const isHost = !!s.room && s.room.hostId === s.playerId;
  return { ...s, me, isHost };
}
