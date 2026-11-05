// Shows a finished drawing, either all at once or replaying stroke by stroke.
// Tap a replaying drawing to watch it again.

import { useEffect, useRef, useState } from "react";
import { CANVAS_H, CANVAS_W, type Stroke } from "../../shared/types";
import { clearCanvas, context, drawStroke, makeCanvas, renderAll } from "./render";
import { buildTimeline } from "./replay";

interface Props {
  strokes: Stroke[];
  replay?: boolean;
  label?: string;
}

export function StrokeView({ strokes, replay = false, label = "Drawing" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = context(canvas);
    if (!replay) {
      renderAll(ctx, strokes);
      return;
    }

    const committed = makeCanvas();
    const cctx = context(committed);
    clearCanvas(cctx);
    const tl = buildTimeline(strokes);
    const n = tl.time.length;
    let k = 0; // next event
    let doneUpTo = 0; // strokes [0, doneUpTo) are committed
    let partial: { stroke: number; count: number } | null = null;
    let raf = 0;
    const start = performance.now();
    setPlaying(true);

    const step = () => {
      const now = performance.now() - start;
      while (k < n && tl.time[k] <= now) {
        const si = tl.stroke[k];
        const cnt = tl.count[k];
        while (doneUpTo < si) drawStroke(cctx, strokes[doneUpTo++], true);
        if (cnt >= strokes[si].points.length) {
          drawStroke(cctx, strokes[si], true);
          doneUpTo = si + 1;
          partial = null;
        } else {
          partial = { stroke: si, count: cnt };
        }
        k++;
      }
      ctx.drawImage(committed, 0, 0);
      if (partial) drawStroke(ctx, strokes[partial.stroke], false, partial.count);
      if (k < n) raf = requestAnimationFrame(step);
      else {
        while (doneUpTo < strokes.length) drawStroke(cctx, strokes[doneUpTo++], true);
        ctx.drawImage(committed, 0, 0);
        setPlaying(false);
      }
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [strokes, replay, run]);

  return (
    <div
      className={`canvas-frame ${replay ? "clickable" : ""}`}
      onClick={() => replay && !playing && setRun((r) => r + 1)}
      title={replay ? "Tap to replay" : undefined}
    >
      <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} aria-label={label} role="img" />
    </div>
  );
}
