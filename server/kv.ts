// A tiny key-value store interface for the Vercel version.
// - UpstashStore talks to Upstash Redis over its REST API (what runs on Vercel).
// - MemoryStore keeps everything in memory (local development and tests).

export type Cmd = (string | number)[];

export interface Store {
  /** Run several Redis commands in one round trip. Returns each command's result. */
  pipeline(cmds: Cmd[]): Promise<unknown[]>;
}

export class UpstashStore implements Store {
  constructor(
    private url: string,
    private token: string,
  ) {}

  async pipeline(cmds: Cmd[]): Promise<unknown[]> {
    if (!cmds.length) return [];
    const res = await fetch(`${this.url.replace(/\/+$/, "")}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(cmds.map((c) => c.map(String))),
    });
    if (!res.ok) throw new Error(`Database error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { result?: unknown; error?: string }[];
    return data.map((d) => {
      if (d.error) throw new Error(`Database error: ${d.error}`);
      return d.result ?? null;
    });
  }
}

/** Reads the Upstash settings Vercel adds when you connect the database. */
export function storeFromEnv(env: Record<string, string | undefined>): Store | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new UpstashStore(url, token) : null;
}

interface Entry {
  value: string | Map<string, string>;
  expiresAt: number | null;
}

/** In-memory stand-in for Redis, supporting just the commands the game uses. */
export class MemoryStore implements Store {
  private data = new Map<string, Entry>();
  /** Commands run so far (handy for checking how chatty the game is). */
  commands = 0;
  constructor(private now: () => number = Date.now) {}

  private get(key: string): Entry | undefined {
    const e = this.data.get(key);
    if (e && e.expiresAt !== null && e.expiresAt <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  async pipeline(cmds: Cmd[]): Promise<unknown[]> {
    return cmds.map((c) => this.run(c.map(String)));
  }

  private run([name, ...args]: string[]): unknown {
    this.commands++;
    const cmd = name.toUpperCase();
    switch (cmd) {
      case "GET": {
        const e = this.get(args[0]);
        return e && typeof e.value === "string" ? e.value : null;
      }
      case "MGET":
        return args.map((k) => {
          const e = this.get(k);
          return e && typeof e.value === "string" ? e.value : null;
        });
      case "SET": {
        const [key, value, ...opts] = args;
        let nx = false;
        let ttl: number | null = null;
        for (let i = 0; i < opts.length; i++) {
          const o = opts[i].toUpperCase();
          if (o === "NX") nx = true;
          else if (o === "EX") ttl = Number(opts[++i]) * 1000;
          else if (o === "PX") ttl = Number(opts[++i]);
        }
        if (nx && this.get(key)) return null;
        this.data.set(key, { value, expiresAt: ttl === null ? null : this.now() + ttl });
        return "OK";
      }
      case "DEL": {
        let n = 0;
        for (const k of args) if (this.data.delete(k)) n++;
        return n;
      }
      case "EXISTS":
        return args.filter((k) => this.get(k)).length;
      case "EXPIRE": {
        const e = this.get(args[0]);
        if (!e) return 0;
        e.expiresAt = this.now() + Number(args[1]) * 1000;
        return 1;
      }
      case "HSET": {
        let e = this.get(args[0]);
        if (!e || typeof e.value === "string") {
          e = { value: new Map(), expiresAt: null };
          this.data.set(args[0], e);
        }
        const map = e.value as Map<string, string>;
        let added = 0;
        for (let i = 1; i + 1 < args.length; i += 2) {
          if (!map.has(args[i])) added++;
          map.set(args[i], args[i + 1]);
        }
        return added;
      }
      case "HGETALL": {
        const e = this.get(args[0]);
        if (!e || typeof e.value === "string") return [];
        return [...e.value].flat();
      }
      default:
        throw new Error(`MemoryStore: unsupported command ${cmd}`);
    }
  }
}
