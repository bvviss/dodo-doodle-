import { useRef, useState } from "react";
import { LIMITS } from "../../shared/types";
import { StrokeView } from "../canvas/StrokeView";
import { client, useGame } from "../net";
import { TopBar, useOnDeadline } from "../ui";

export function Guess() {
  const { room, task } = useGame();
  const [text, setText] = useState("");
  const sent = useRef(false);

  function submit() {
    if (sent.current) return;
    sent.current = true;
    client.send({ type: "submit", text });
  }
  useOnDeadline(room?.deadline ?? null, submit);

  if (!room || !task || task.kind !== "guess") return null;

  return (
    <div className="app play stack">
      <TopBar />
      <div className="instruction">What is this drawing?</div>
      {task.strokes.length ? (
        <StrokeView strokes={task.strokes} replay />
      ) : (
        <div className="canvas-frame" style={{ display: "grid", placeItems: "center" }}>
          <span className="muted" style={{ fontWeight: 800 }}>
            (They didn't draw anything… take a wild guess! 🙈)
          </span>
        </div>
      )}
      <div className="card tilt-l row">
        <input
          className="input grow"
          value={text}
          maxLength={LIMITS.maxText}
          placeholder="Type your guess…"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && text.trim() && submit()}
          aria-label="Your guess"
          style={{ flexBasis: 200 }}
        />
        <button className="btn go big" disabled={!text.trim()} onClick={submit}>
          ✅ Done
        </button>
      </div>
    </div>
  );
}
