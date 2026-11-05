import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  chainForSeat,
  chainLength,
  chainSurvived,
  finalMatch,
  matchGuess,
  pickModifier,
  sanitizeCustomWords,
  sanitizeName,
  sanitizeSettings,
  sanitizeStrokes,
  sanitizeText,
  scoreGame,
  seatForChain,
  turnKind,
  voteThreshold,
} from "../shared/rules";
import { CHAIN_LENGTHS, LIMITS, type Step } from "../shared/types";
import { PACKS, wordsFor } from "../shared/words";

describe("passing rule", () => {
  for (let n = 3; n <= 10; n++) {
    it(`never repeats a chain for ${n} players`, () => {
      for (const cap of CHAIN_LENGTHS) {
        const L = chainLength(n, cap);
        // Every seat works on exactly one chain per turn, and every chain gets exactly one worker.
        for (let t = 0; t < L; t++) {
          const chains = new Set<number>();
          for (let s = 0; s < n; s++) chains.add(chainForSeat(s, t, n));
          expect(chains.size).toBe(n);
          for (let c = 0; c < n; c++) expect(chainForSeat(seatForChain(c, t, n), t, n)).toBe(c);
        }
        // Nobody sees the same chain twice.
        for (let s = 0; s < n; s++) {
          const seen = new Set<number>();
          for (let t = 0; t < L; t++) seen.add(chainForSeat(s, t, n));
          expect(seen.size).toBe(L);
        }
        // Each chain is worked on by L different people.
        for (let c = 0; c < n; c++) {
          const workers = new Set<number>();
          for (let t = 0; t < L; t++) workers.add(seatForChain(c, t, n));
          expect(workers.size).toBe(L);
        }
        // Seat c starts chain c.
        for (let c = 0; c < n; c++) expect(seatForChain(c, 0, n)).toBe(c);
      }
    });
  }
});

describe("chain length", () => {
  it("always ends on a guess", () => {
    for (let n = 3; n <= 10; n++) {
      for (const cap of CHAIN_LENGTHS) {
        const L = chainLength(n, cap);
        expect(L).toBeGreaterThanOrEqual(3);
        expect(L).toBeLessThanOrEqual(n);
        expect(L % 2).toBe(1);
        expect(turnKind(L - 1)).toBe("guess");
        if (cap > 0) expect(L).toBeLessThanOrEqual(cap);
      }
    }
  });
  it("matches the examples", () => {
    expect(chainLength(8, 0)).toBe(7);
    expect(chainLength(3, 0)).toBe(3);
    expect(chainLength(4, 0)).toBe(3);
    expect(chainLength(10, 5)).toBe(5);
    expect(chainLength(10, 7)).toBe(7);
    expect(chainLength(6, 7)).toBe(5);
  });
  it("alternates prompt, draw, guess", () => {
    expect(["prompt", "draw", "guess", "draw", "guess"]).toEqual([0, 1, 2, 3, 4].map(turnKind));
  });
});

describe("matchGuess", () => {
  const table: [string, string, string][] = [
    ["cat", "Cats", "exact"],
    ["cat", "a cat", "exact"],
    ["elephant", "elefant", "exact"],
    ["ice cream", "icecream", "exact"],
    ["hot dog", "Hot-dog!", "exact"],
    ["butterflies", "butterfly", "exact"],
    ["a dog driving a bus", "bus", "close"],
    ["angry goose", "goose", "close"],
    ["dog", "cat", "miss"],
    ["cat", "car", "miss"],
  ];
  for (const [target, guess, expected] of table) {
    it(`${target} / ${guess} → ${expected}`, () => {
      expect(matchGuess(target, guess)).toBe(expected);
    });
  }
  it("??? and empty are always a miss", () => {
    expect(matchGuess("cat", "???")).toBe("miss");
    expect(matchGuess("cat", "")).toBe("miss");
    expect(matchGuess("cat", "   ")).toBe("miss");
  });
  it("strips accents", () => {
    expect(matchGuess("cafe", "Café")).toBe("exact");
  });
  it("singularizes es words", () => {
    expect(matchGuess("box", "boxes")).toBe("exact");
    expect(matchGuess("bus", "bus")).toBe("exact");
  });
});

// ---------------------------------------------------------------- scoring

function guess(authorId: string, text: string, match: "exact" | "close" | "miss", votes: string[] = []): Step {
  return { kind: "guess", authorId, authorName: authorId, text, autoMatch: match, match, votes };
}
function drawing(authorId: string): Step {
  return { kind: "drawing", authorId, authorName: authorId, strokes: [] };
}
function prompt(authorId: string, text: string): Step {
  return { kind: "prompt", authorId, authorName: authorId, text };
}

describe("scoring", () => {
  it("gives guesser and drawer the same points", () => {
    const chains: Step[][] = [
      [prompt("a", "cat"), drawing("b"), guess("c", "cat", "exact"), drawing("d"), guess("e", "kitten", "miss")],
      [prompt("b", "dog"), drawing("c"), guess("d", "big dog", "close"), drawing("e"), guess("a", "frog", "miss")],
    ];
    const scores = scoreGame(chains, ["a", "b", "c", "d", "e"]);
    const by = Object.fromEntries(scores.map((s) => [s.playerId, s]));
    expect(by.b.points).toBe(100);
    expect(by.c.points).toBe(150); // 100 as guesser + 50 as drawer
    expect(by.d.points).toBe(50);
    expect(by.c.exact).toBe(1);
    expect(by.c.close).toBe(1);
    expect(by.a.points).toBe(0);
    expect(by.e.points).toBe(0);
    // sorted best first
    expect(scores[0].playerId).toBe("c");
  });

  it("gives a chain bonus when the final guess still matches the original prompt", () => {
    const chain: Step[] = [
      prompt("a", "angry goose"),
      drawing("b"),
      guess("c", "duck", "miss"),
      drawing("d"),
      guess("e", "goose", "miss"),
    ];
    expect(chainSurvived(chain)).toBe(true);
    const by = Object.fromEntries(scoreGame([chain], ["a", "b", "c", "d", "e"]).map((s) => [s.playerId, s]));
    for (const id of ["a", "b", "c", "d", "e"]) expect(by[id].chainBonus).toBe(50);
    expect(by.e.points).toBe(50);
  });

  it("no chain bonus when the chain drifted", () => {
    const chain: Step[] = [prompt("a", "cat"), drawing("b"), guess("c", "dog", "miss"), drawing("d"), guess("e", "wolf", "miss")];
    expect(chainSurvived(chain)).toBe(false);
  });

  it("vote upgrades count as close", () => {
    expect(voteThreshold(0)).toBe(1);
    expect(voteThreshold(1)).toBe(1);
    expect(voteThreshold(3)).toBe(2);
    expect(voteThreshold(4)).toBe(2);
    expect(finalMatch("miss", 2, 2)).toBe("close");
    expect(finalMatch("miss", 1, 2)).toBe("miss");
    expect(finalMatch("exact", 0, 2)).toBe("exact");
    const g = guess("c", "kitty", "miss");
    if (g.kind === "guess") g.match = finalMatch(g.autoMatch, 2, 2);
    const by = Object.fromEntries(
      scoreGame([[prompt("a", "cat"), drawing("b"), g]], ["a", "b", "c"]).map((s) => [s.playerId, s]),
    );
    expect(by.c.points).toBe(50 + 50); // close + chain bonus (3-step chain uses final match)
    expect(by.b.points).toBe(50 + 50);
    expect(by.a.points).toBe(50);
  });
});

// ---------------------------------------------------------------- validation

describe("sanitizeSettings", () => {
  it("accepts valid values", () => {
    const s = sanitizeSettings({ drawTime: 120, guessTime: 25, promptSource: "packs", packs: ["food"], difficulty: "hard" });
    expect(s.drawTime).toBe(120);
    expect(s.guessTime).toBe(25);
    expect(s.promptSource).toBe("packs");
    expect(s.packs).toEqual(["food"]);
    expect(s.difficulty).toBe("hard");
  });
  it("rejects bad values and keeps the previous ones", () => {
    const s = sanitizeSettings({
      drawTime: 9999,
      guessTime: "40",
      promptTime: -1,
      promptSource: "hacker",
      packs: ["nope"],
      difficulty: "impossible",
      chainLength: 4,
      modifiers: "always",
      callLink: "javascript:alert(1)",
      evil: true,
    });
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect("evil" in s).toBe(false);
  });
  it("handles garbage input", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings("lol")).toEqual(DEFAULT_SETTINGS);
  });
  it("validates the call link", () => {
    expect(sanitizeSettings({ callLink: "https://meet.google.com/abc" }).callLink).toBe("https://meet.google.com/abc");
    expect(sanitizeSettings({ callLink: "http://example.com" }).callLink).toBe("");
    const prev = { ...DEFAULT_SETTINGS, callLink: "https://discord.gg/x" };
    expect(sanitizeSettings({ callLink: "" }, prev).callLink).toBe("");
    expect(sanitizeSettings({ callLink: "ftp://x" }, prev).callLink).toBe("https://discord.gg/x");
  });
});

describe("input sanitizing", () => {
  it("cleans text", () => {
    expect(sanitizeText("  hello \n  world  ")).toBe("hello world");
    expect(sanitizeText("x".repeat(100)).length).toBe(LIMITS.maxText);
    expect(sanitizeText(42)).toBe("");
  });
  it("makes names unique and short", () => {
    expect(sanitizeName("Sam", ["sam"])).toBe("Sam 2");
    expect(sanitizeName("Sam", ["Sam", "Sam 2"])).toBe("Sam 3");
    expect(sanitizeName("A very very long name here", []).length).toBeLessThanOrEqual(LIMITS.maxName);
    expect(sanitizeName("   ", [])).toBe("Player");
  });
  it("cleans custom words", () => {
    expect(sanitizeCustomWords("cat\n\n  dog \ncat\nCAT")).toEqual(["cat", "dog"]);
    const many = Array.from({ length: 900 }, (_, i) => `word${i}`);
    expect(sanitizeCustomWords(many).length).toBe(LIMITS.maxCustomWords);
  });
  it("cleans strokes", () => {
    const out = sanitizeStrokes([
      { tool: "pen", colour: "#FF0000", size: 999, points: [[-50, 9999, 5], [10.6, 20.2, 7]] },
      { tool: "laser", colour: "#ff0000", size: 4, points: [[1, 1, 0]] },
      { tool: "pen", colour: "red", size: 4, points: [[1, 1, 0]] },
      { tool: "fill", colour: "#00ff00", size: 1, points: [[5, 5, 0], [6, 6, 1]] },
      { tool: "pen", colour: "#000000", size: 4, points: [] },
      "junk",
    ]);
    expect(out).toEqual([
      { tool: "pen", colour: "#ff0000", size: 80, points: [[0, 600, 5], [11, 20, 7]] },
      { tool: "fill", colour: "#00ff00", size: 1, points: [[5, 5, 0]] },
    ]);
  });
  it("caps strokes and points", () => {
    const many = Array.from({ length: 5000 }, () => ({ tool: "pen", colour: "#000000", size: 4, points: [[1, 1, 0]] }));
    expect(sanitizeStrokes(many).length).toBe(LIMITS.maxStrokes);
    const long = Array.from({ length: 40 }, () => ({
      tool: "pen",
      colour: "#000000",
      size: 4,
      points: Array.from({ length: 1000 }, (_, i) => [i % 800, 1, i]),
    }));
    const total = sanitizeStrokes(long).reduce((n, s) => n + s.points.length, 0);
    expect(total).toBe(LIMITS.maxPoints);
  });
});

describe("modifiers", () => {
  it("off never picks a modifier", () => {
    for (let i = 0; i < 50; i++) expect(pickModifier("off", Math.random)).toBeNull();
  });
  it("random picks roughly 1 in 3", () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    let hits = 0;
    const ids = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const m = pickModifier("random", rnd);
      if (m) {
        hits++;
        ids.add(m.id);
        if (m.id === "threeColours") {
          expect(m.canvas.palette).toHaveLength(3);
          expect(m.canvas.palette).not.toContain("#1b1b1b");
        }
        if (m.id === "speed") expect(m.drawTime).toBe(30);
        if (m.id === "noUndo") expect(m.canvas.noUndo).toBe(true);
      }
    }
    expect(hits).toBeGreaterThan(800);
    expect(hits).toBeLessThan(1200);
    expect(ids.size).toBe(3);
  });
});

describe("word packs", () => {
  it("has enough words", () => {
    for (const p of PACKS) {
      if (p.id === "silly") {
        expect(p.hard.length).toBeGreaterThanOrEqual(30);
      } else {
        expect(p.easy.length).toBeGreaterThanOrEqual(30);
        expect(p.hard.length).toBeGreaterThanOrEqual(15);
      }
      for (const w of [...p.easy, ...p.hard]) expect(w.length).toBeLessThanOrEqual(LIMITS.maxText);
    }
  });
  it("filters by difficulty", () => {
    expect(wordsFor(["food"], "easy")).toContain("nasi lemak");
    expect(wordsFor(["food"], "easy")).not.toContain("laksa");
    expect(wordsFor(["food"], "hard")).toContain("laksa");
    expect(wordsFor(["food"], "medium")).toEqual(expect.arrayContaining(["laksa", "nasi lemak"]));
    expect(wordsFor(["silly"], "easy").length).toBeGreaterThan(0);
  });
});
