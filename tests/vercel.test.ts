import { describe, expect, it } from "vitest";
import { handleRoom, SWEEP_MS, type PollRequest } from "../server/game";
import { MemoryStore } from "../server/kv";
import { GRACE_MS, type ClientMsg, type PublicRoom, type ServerMsg, type Step, type Task } from "../shared/types";
import { PRESENCE_MS } from "../worker/room";

const CODE = "BCDF";

function setup() {
  const clock = { t: 1_000_000 };
  const now = () => clock.t;
  const store = new MemoryStore(now);
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return { clock, store, opts: { now, random } };
}

/** A pretend browser that checks in like src/net.ts does. */
class Browser {
  token = "";
  v = -1;
  taskSeq = -1;
  lr = 0;
  room: PublicRoom | null = null;
  task: Task | null = null;
  submitted = false;
  playerId = "";
  chains: Record<number, Step[]> = {};
  errors: ServerMsg[] = [];
  reactions = 0;
  lastResponse: { v: number; msgs: ServerMsg[] } | null = null;

  constructor(
    private env: ReturnType<typeof setup>,
    public name: string,
  ) {}

  async poll(msgs: ClientMsg[] = []) {
    const r = this.room?.reveal;
    const rc = r ? r.chain : -1;
    const req: PollRequest = {
      token: this.token,
      v: this.v,
      taskSeq: this.taskSeq,
      rc,
      rh: this.chains[rc]?.filter(Boolean).length ?? 0,
      lr: this.lr,
      msgs,
    };
    const raw = await handleRoom(this.env.store, CODE, JSON.parse(JSON.stringify(req)), this.env.opts);
    const res = JSON.parse(raw) as { v: number; msgs: ServerMsg[]; retry?: boolean };
    this.lastResponse = res;
    this.v = res.v;
    for (const m of res.msgs) {
      if (m.type === "welcome") {
        this.token = m.token;
        this.playerId = m.playerId;
      } else if (m.type === "state") {
        this.room = m.room;
        this.taskSeq = m.you.taskSeq;
        this.submitted = m.you.submitted;
        if (m.you.task !== undefined) this.task = m.you.task;
      } else if (m.type === "revealData" || m.type === "chain") {
        const arr = m.type === "chain" ? [] : (this.chains[m.chainIndex] ?? []);
        const from = m.type === "chain" ? 0 : m.fromStep;
        m.steps.forEach((s, i) => (arr[from + i] = s));
        this.chains[m.chainIndex] = arr;
      } else if (m.type === "reaction") {
        this.reactions++;
        if (m.id) this.lr = Math.max(this.lr, m.id);
      } else if (m.type === "error") this.errors.push(m);
    }
    return res;
  }

  join() {
    return this.poll([{ type: "join", name: this.name, colour: "#3a86ff", token: this.token || undefined }]);
  }

  /** Answer the current task. */
  answer() {
    const t = this.task;
    if (!t || this.submitted) return this.poll();
    if (t.kind === "prompt") return this.poll([{ type: "submit", text: t.dealt ?? `${this.name}'s cat` }]);
    if (t.kind === "draw") {
      const points = Array.from({ length: 400 }, (_, i) => [i % 800, (i * 7) % 600, i * 10] as [number, number, number]);
      return this.poll([{ type: "submit", strokes: [{ tool: "pen", colour: "#e63946", size: 8, points }] }]);
    }
    return this.poll([{ type: "submit", text: "cat" }]);
  }
}

describe("Vercel game server (check-ins)", () => {
  it("plays a whole game with two browsers and bots", async () => {
    const env = setup();
    const a = new Browser(env, "Ana");
    const b = new Browser(env, "Ben");
    await a.join();
    await b.join();
    expect(a.playerId).toBeTruthy();
    expect(b.playerId).toBeTruthy();
    await a.poll([{ type: "addBot" }, { type: "addBot" }]);
    await b.poll();
    expect(b.room!.players.map((p) => p.name)).toEqual(["Ana", "Ben", "Bot Bella", "Bot Boris"]);
    expect(b.room!.hostId).toBe(a.playerId);

    await a.poll([{ type: "start" }]);
    await b.poll();
    expect(b.room!.phase).toBe("prompt");
    const total = a.room!.totalTurns;
    expect(total).toBe(3);

    for (let turn = 0; turn < total; turn++) {
      expect(a.task?.kind).toBe(a.room!.phase === "draw" ? "draw" : a.room!.phase);
      await a.answer();
      await b.answer();
      env.clock.t += 4000; // bots answer within 3.7 s; their timers run on the next check-in
      await a.poll();
      await b.poll();
    }
    expect(a.room!.phase).toBe("reveal");

    // Guess tasks carried the real drawing, loaded from its own key.
    // Reveal everything.
    let guard = 0;
    while (a.room!.phase === "reveal" && guard++ < 50) {
      await a.poll([{ type: "revealNext" }]);
      await b.poll();
    }
    expect(a.room!.phase).toBe("scores");
    expect(a.room!.scores!.length).toBe(4);
    // B got every revealed step of the last chain, including full drawings.
    const lastChain = b.chains[3];
    expect(lastChain.map((s) => s.kind)).toEqual(["prompt", "drawing", "guess"]);
    const drawing = lastChain[1];
    expect(drawing.kind === "drawing" && drawing.strokes.length).toBeGreaterThan(0);

    await a.poll([{ type: "getChain", chain: 0 }]);
    expect(a.chains[0].length).toBe(3);

    await a.poll([{ type: "playAgain" }]);
    expect(a.room!.phase).toBe("lobby");
  });

  it("quiet check-ins are cheap and don't reload the room", async () => {
    const env = setup();
    const a = new Browser(env, "Ana");
    await a.join();
    await a.poll();
    const before = env.store.commands;
    env.clock.t += 1000;
    const res = await a.poll();
    expect(res.msgs).toEqual([]);
    expect(env.store.commands - before).toBe(2); // HSET check-in + GET meta
  });

  it("other players see changes on their next check-in", async () => {
    const env = setup();
    const a = new Browser(env, "Ana");
    const b = new Browser(env, "Ben");
    await a.join();
    await b.join();
    await b.poll();
    env.clock.t += 1000;
    await a.poll([{ type: "settings", settings: { drawTime: 120 } }]);
    const res = await b.poll();
    expect(res.msgs.some((m) => m.type === "state")).toBe(true);
    expect(b.room!.settings.drawTime).toBe(120);
  });

  it("stores drawings separately so the saved room stays small", async () => {
    const env = setup();
    const a = new Browser(env, "Ana");
    await a.join();
    await a.poll([{ type: "addBot" }, { type: "addBot" }, { type: "start" }]);
    await a.answer();
    env.clock.t += 4000;
    await a.poll();
    expect(a.room!.phase).toBe("draw");
    await a.answer();
    env.clock.t += 4000;
    await a.poll();
    expect(a.room!.phase).toBe("guess");
    const snap = (await env.store.pipeline([["GET", `dc:${CODE}:s`]]))[0] as string;
    expect(snap.length).toBeLessThan(20_000);
    expect(snap).toContain('"$s"');
    // The guess task still arrives with real strokes.
    expect(a.task?.kind === "guess" && a.task.strokes.length).toBeGreaterThan(0);
  });

  it("players who stop checking in are dropped from the turn", async () => {
    const env = setup();
    const a = new Browser(env, "Ana");
    const b = new Browser(env, "Ben");
    const c = new Browser(env, "Cat");
    await a.join();
    await b.join();
    await c.join();
    await a.poll([{ type: "start" }]);
    await b.poll();
    await a.answer();
    await b.answer();
    expect(b.submitted).toBe(true);
    expect(a.room!.turn).toBe(0);
    // Cat goes quiet. After the presence window, the turn moves on without them.
    for (let i = 0; i < 6; i++) {
      env.clock.t += SWEEP_MS / 2;
      await a.poll();
      await b.poll();
    }
    expect(env.clock.t).toBeGreaterThan(1_000_000 + PRESENCE_MS);
    await a.poll();
    expect(a.room!.turn).toBe(1);
    expect(a.room!.players.find((p) => p.name === "Cat")!.connected).toBe(false);
    // Cat comes back with their token and lands in the current turn.
    await c.poll();
    expect(c.room!.turn).toBe(1);
    expect(c.task?.kind).toBe("draw");
    await a.poll();
    expect(a.room!.players.find((p) => p.name === "Cat")!.connected).toBe(true);
  });

  it("turns time out even when nobody acts", async () => {
    const env = setup();
    const a = new Browser(env, "Ana");
    await a.join();
    await a.poll([{ type: "addBot" }, { type: "addBot" }, { type: "start" }]);
    const deadline = a.room!.deadline!;
    // Keep checking in without answering.
    while (env.clock.t < deadline + GRACE_MS + 10) {
      env.clock.t += 1500;
      await a.poll();
    }
    expect(a.room!.phase).toBe("draw");
  });

  it("reactions reach other players", async () => {
    const env = setup();
    const a = new Browser(env, "Ana");
    const b = new Browser(env, "Ben");
    await a.join();
    await b.join();
    await b.poll();
    await a.poll([{ type: "react", emoji: "😂" }]);
    await b.poll();
    expect(b.reactions).toBe(1);
    await b.poll();
    expect(b.reactions).toBe(1); // not repeated
  });

  it("unknown tokens are told the room is gone; late joiners see 'in progress'", async () => {
    const env = setup();
    const ghost = new Browser(env, "Ghost");
    ghost.token = "nope";
    await ghost.poll();
    expect(ghost.errors[0]).toMatchObject({ type: "error", code: "gone" });

    const a = new Browser(env, "Ana");
    await a.join();
    await a.poll([{ type: "addBot" }, { type: "addBot" }, { type: "start" }]);
    const late = new Browser(env, "Late");
    await late.join();
    expect(late.errors[0]).toMatchObject({ code: "in_progress" });
  });

  it("handles many check-ins at the same time without losing answers", async () => {
    const env = setup();
    const players = ["A", "B", "C", "D", "E", "F"].map((n) => new Browser(env, n));
    for (const p of players) await p.join();
    await players[0].poll([{ type: "start" }]);
    await Promise.all(players.map((p) => p.poll()));
    await Promise.all(players.map((p) => p.answer()));
    await players[0].poll();
    expect(players[0].room!.phase).toBe("draw");
  });
});
