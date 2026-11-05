import { useEffect, useRef, useState } from "react";
import { AUTOSAVE_MS, PALETTE, PEN_SIZES, type Stroke, type Tool } from "../../shared/types";
import { DrawCanvas, type DrawCanvasHandle, type HistoryInfo } from "../canvas/DrawCanvas";
import { Toolbar } from "../canvas/Toolbar";
import { client, useGame } from "../net";
import { TopBar, useOnDeadline } from "../ui";

export function Draw() {
  const { room, task } = useGame();
  const canvas = useRef<DrawCanvasHandle>(null);
  const sent = useRef(false);
  const latest = useRef<Stroke[]>([]);
  const dirty = useRef(false);

  const modifier = task?.kind === "draw" ? task.modifier : null;
  const palette = modifier?.canvas.palette ?? PALETTE;
  const noUndo = !!modifier?.canvas.noUndo;

  const [tool, setTool] = useState<Tool>("pen");
  const [colour, setColour] = useState<string>(palette[0]);
  const [size, setSize] = useState<number>(PEN_SIZES[1]);
  const [history, setHistory] = useState<HistoryInfo>({ canUndo: false, canRedo: false, count: 0, full: false });
  const [bannerUp, setBannerUp] = useState(() => task?.kind === "draw" && !!task.modifier && client.serverNow() < task.startsAt);

  // Hide the modifier banner when drawing starts.
  useEffect(() => {
    if (!bannerUp || task?.kind !== "draw") return;
    const id = setInterval(() => {
      if (client.serverNow() >= task.startsAt) setBannerUp(false);
    }, 100);
    return () => clearInterval(id);
  }, [bannerUp, task]);

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
      {modifier && (
        <div className="row center" style={{ marginBottom: 10 }}>
          <span className="modifier-chip">
            {modifier.emoji} {modifier.name}
          </span>
        </div>
      )}
      <div className="draw-layout">
        <div className={`canvas-frame drawing ${tool === "fill" ? "fill" : ""}`}>
          <DrawCanvas
            ref={canvas}
            tool={noUndo && tool === "eraser" ? "pen" : tool}
            colour={colour}
            size={size}
            initial={task.draft}
            disabled={bannerUp}
            onChange={(strokes, info) => {
              latest.current = strokes;
              dirty.current = true;
              setHistory(info);
            }}
          />
          {bannerUp && modifier && (
            <div className="modifier-banner">
              <div className="card yellow">
                <div className="emoji">{modifier.emoji}</div>
                <h2>{modifier.name}!</h2>
                <div style={{ fontWeight: 700 }}>{modifier.description}</div>
              </div>
            </div>
          )}
        </div>
        {history.full && <div className="notice center-text">This drawing is as detailed as it can get — time to hit Done!</div>}
        <Toolbar
          tool={tool}
          colour={colour}
          size={size}
          palette={palette}
          noUndo={noUndo}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onTool={setTool}
          onColour={setColour}
          onSize={setSize}
          onUndo={() => canvas.current?.undo()}
          onRedo={() => canvas.current?.redo()}
          onClear={() => canvas.current?.clear()}
        />
        <div className="row center">
          <button className="btn go big" onClick={submit} disabled={bannerUp}>
            ✅ Done
          </button>
        </div>
      </div>
    </div>
  );
}
