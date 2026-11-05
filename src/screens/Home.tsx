import { useState } from "react";
import { LIMITS, PLAYER_COLOURS, ROOM_CODE_RE } from "../../shared/types";
import { client, useGame } from "../net";
import { apiUrl } from "../server";
import { storage } from "../storage";
import { Logo } from "../ui";

export function goTo(path: string) {
  if (location.pathname !== path) history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function Home({ urlCode }: { urlCode: string | null }) {
  const { fatal, status } = useGame();
  const saved = storage.profile();
  const [name, setName] = useState(saved?.name ?? "");
  const [colour, setColour] = useState<string>(saved?.colour ?? PLAYER_COLOURS[Math.floor(Math.random() * PLAYER_COLOURS.length)]);
  const [code, setCode] = useState(urlCode ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const cleanName = name.trim();
  const codeUpper = code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  const codeOk = ROOM_CODE_RE.test(codeUpper);
  const connecting = busy || status === "connecting";

  function enter(roomCode: string) {
    storage.setProfile({ name: cleanName, colour });
    goTo(`/r/${roomCode}`);
    client.join(roomCode, cleanName, colour);
  }

  async function create() {
    if (!cleanName) return setProblem("Type your name first!");
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(apiUrl("/api/new"));
      const data = (await res.json()) as { code?: string };
      if (!data.code) throw new Error("no code");
      enter(data.code);
    } catch {
      setProblem("Couldn't create a room. Check your internet and try again.");
    } finally {
      setBusy(false);
    }
  }

  function joinRoom() {
    if (!cleanName) return setProblem("Type your name first!");
    if (!codeOk) return setProblem("Room codes are 4 letters, like BCDF.");
    setProblem(null);
    enter(codeUpper);
  }

  return (
    <div className="app home">
      <Logo />
      <p className="tagline">Draw it. Guess it. Pass it on. 🎨</p>

      <div className="card tilt-l stack">
        <div>
          <label className="label" htmlFor="name">
            Your name
          </label>
          <input
            id="name"
            className="input"
            value={name}
            maxLength={LIMITS.maxName}
            placeholder="e.g. Sam"
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (urlCode ? joinRoom() : create())}
          />
        </div>
        <div>
          <span className="label">Your colour</span>
          <div className="swatches" role="radiogroup" aria-label="Your colour">
            {PLAYER_COLOURS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === colour}
                aria-label={c}
                className={`swatch ${c === colour ? "selected" : ""}`}
                style={{ background: c }}
                onClick={() => setColour(c)}
              />
            ))}
          </div>
        </div>

        {fatal && <div className="notice">{fatal.message}</div>}
        {problem && <div className="notice">{problem}</div>}

        {urlCode ? (
          <>
            <button className="btn go big wide" disabled={connecting} onClick={joinRoom}>
              Join room {codeUpper}
            </button>
            <div className="or">or</div>
            <button className="btn wide" disabled={connecting} onClick={create}>
              Create a new room
            </button>
          </>
        ) : (
          <>
            <button className="btn primary big wide" disabled={connecting} onClick={create}>
              ✏️ Create room
            </button>
            <div className="or">or join a friend</div>
            <div className="row">
              <input
                className="input code"
                value={codeUpper}
                placeholder="CODE"
                aria-label="Room code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && joinRoom()}
              />
              <button className="btn blue grow" disabled={connecting} onClick={joinRoom}>
                Join with code
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card tilt-r how" style={{ marginTop: 22 }}>
        <h3>How to play</h3>
        <ol>
          <li>Everyone writes a silly prompt.</li>
          <li>Prompts get passed around: draw what you read, guess what you see.</li>
          <li>Watch every chain unravel at the end — and score points for accuracy!</li>
        </ol>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Best with 6–10 friends (3 is fine, and you can add bots). No accounts, no install.
        </p>
      </div>
    </div>
  );
}
