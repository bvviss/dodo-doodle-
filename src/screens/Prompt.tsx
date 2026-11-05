import { useRef, useState } from "react";
import { LIMITS } from "../../shared/types";
import { client, useGame } from "../net";
import { TopBar, useOnDeadline } from "../ui";

const IDEAS = ["a cat doing taxes", "grandma on a skateboard", "a shark at the dentist", "nasi lemak volcano", "a robot in love"];

export function Prompt() {
  const { room, task } = useGame();
  const [text, setText] = useState("");
  const sent = useRef(false);
  const [idea] = useState(() => IDEAS[Math.floor(Math.random() * IDEAS.length)]);
  const dealt = task?.kind === "prompt" ? task.dealt : null;

  function submit() {
    if (sent.current) return;
    sent.current = true;
    client.send({ type: "submit", text: dealt ?? text });
  }
  useOnDeadline(room?.deadline ?? null, submit);

  if (!room || !task || task.kind !== "prompt") return null;

  return (
    <div className="app play stack">
      <TopBar />
      {dealt ? (
        <>
          <div className="instruction">Your prompt is…</div>
          <div className="card yellow tilt-l dealt">{dealt}</div>
          <p className="center-text muted" style={{ margin: 0 }}>
            Someone else will have to draw this. Don't tell anyone! 🤫
          </p>
          <div className="row center">
            {task.rerollsLeft > 0 && (
              <button className="btn" onClick={() => client.send({ type: "reroll" })}>
                🎲 Re-roll ({task.rerollsLeft} left)
              </button>
            )}
            <button className="btn go big" onClick={submit}>
              ✅ Done
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="instruction">Write something for someone to draw!</div>
          <div className="card tilt-r stack">
            <input
              className="input"
              autoFocus
              value={text}
              maxLength={LIMITS.maxText}
              placeholder={`e.g. ${idea}`}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && text.trim() && submit()}
              aria-label="Your prompt"
            />
            <div className="row between">
              <span className="muted small">
                {text.length}/{LIMITS.maxText} · Silly is good. Too hard is no fun.
              </span>
              <button className="btn go big" disabled={!text.trim()} onClick={submit}>
                ✅ Done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
