import { useEffect, useRef } from "react";
import { AUTOSAVE_MS, type Stroke } from "../../shared/types";
import { DrawCanvas, type DrawCanvasHandle } from "../canvas/DrawCanvas";
import { client, useGame } from "../net";
import { TopBar, useOnDeadline } from "../ui";

export function Draw() {
  const { room, task } = useGame();
  const canvas = useRef<DrawCanvasHandle>(null);
  const sent = useRef(false);
  const latest = useRef<Stroke[]>([]);
  const dirty = useRef(false);

  function submit() {
    if (sent.current) return;
    sent.current = true;
    client.send({ type: "submit", strokes: canvas.current?.strokes() ?? latest.current });
  }
  useOnDeadline(room?.deadline ?? null, submit);

  // Autosave every 5 s while drawing, so a timeout or wifi drop doesn't lose the drawing.
  useEffect(() => {
    const id = setInterval(() => {
      if (!dirty.current || sent.current) return;
      dirty.current = false;
      client.send({ type: "autosave", strokes: latest.current });
    }, AUTOSAVE_MS);
    return () => clearInterval(id);
  }, []);

  if (!room || !task || task.kind !== "draw") return null;

  return (
    <div className="app play">
      <TopBar />
      <div className="instruction">
        Draw: <b>{task.phrase}</b>
      </div>
      <div className="draw-layout">
        <div className="canvas-frame drawing">
          <DrawCanvas
            ref={canvas}
            tool="pen"
            colour="#1b1b1b"
            size={8}
            initial={task.draft}
            onChange={(strokes) => {
              latest.current = strokes;
              dirty.current = true;
            }}
          />
        </div>
        <div className="row center">
          <button className="btn go big" onClick={submit}>
            ✅ Done
          </button>
        </div>
      </div>
    </div>
  );
}
