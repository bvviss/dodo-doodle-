// The drawing surface. Pointer events for mouse, touch and stylus.
// Keeps a "committed" offscreen canvas with finished strokes; each frame
// shows committed + the stroke in progress.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { CANVAS_H, CANVAS_W, ERASER_COLOUR, LIMITS, type Point, type Stroke, type Tool } from "../../shared/types";
import { context, countPoints, drawStroke, makeCanvas, renderAll } from "./render";

export interface DrawCanvasHandle {
  undo(): void;
  redo(): void;
  clear(): void;
  strokes(): Stroke[];
}

export interface HistoryInfo {
  canUndo: boolean;
  canRedo: boolean;
  count: number;
  full: boolean;
}

interface Props {
  tool: Tool;
  colour: string;
  size: number;
  initial?: Stroke[];
  disabled?: boolean;
  onChange?: (strokes: Stroke[], info: HistoryInfo) => void;
}

/** Points closer than this to the previous one are skipped. */
const MIN_DIST = 1.5;

export const DrawCanvas = forwardRef<DrawCanvasHandle, Props>(function DrawCanvas(
  { tool, colour, size, initial, disabled = false, onChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const committed = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<Stroke[]>(initial ? [...initial] : []);
  const redoStack = useRef<Stroke[]>([]);
  const current = useRef<Stroke | null>(null);
  const activePointer = useRef<number | null>(null);
  const t0 = useRef(performance.now() - lastTime(initial));
  const frame = useRef(0);
  const props = useRef({ tool, colour, size, disabled, onChange });
  props.current = { tool, colour, size, disabled, onChange };

  const isFull = () => strokes.current.length >= LIMITS.maxStrokes || countPoints(strokes.current) >= LIMITS.maxPoints - 50;

  const notify = useCallback(() => {
    props.current.onChange?.([...strokes.current], {
      canUndo: strokes.current.length > 0,
      canRedo: redoStack.current.length > 0,
      count: strokes.current.length,
      full: isFull(),
    });
  }, []);

  const paint = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    if (!canvas || !committed.current) return;
    const ctx = context(canvas);
    ctx.drawImage(committed.current, 0, 0);
    if (current.current) drawStroke(ctx, current.current, false);
  }, []);

  const requestPaint = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  const recommit = useCallback(() => {
    if (!committed.current) return;
    renderAll(context(committed.current), strokes.current);
    requestPaint();
  }, [requestPaint]);

  useEffect(() => {
    committed.current = makeCanvas();
    recommit();
    notify();
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [recommit, notify]);

  useImperativeHandle(
    ref,
    () => ({
      undo() {
        const s = strokes.current.pop();
        if (s) redoStack.current.push(s);
        recommit();
        notify();
      },
      redo() {
        const s = redoStack.current.pop();
        if (s) strokes.current.push(s);
        recommit();
        notify();
      },
      clear() {
        strokes.current = [];
        redoStack.current = [];
        recommit();
        notify();
      },
      strokes: () => [...strokes.current],
    }),
    [recommit, notify],
  );

  function toPoint(e: { clientX: number; clientY: number }): Point {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * CANVAS_W);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * CANVAS_H);
    return [Math.min(CANVAS_W, Math.max(0, x)), Math.min(CANVAS_H, Math.max(0, y)), Math.round(performance.now() - t0.current)];
  }

  function finish() {
    const s = current.current;
    current.current = null;
    activePointer.current = null;
    if (!s || !committed.current) return;
    drawStroke(context(committed.current), s, true);
    strokes.current.push(s);
    redoStack.current = [];
    requestPaint();
    notify();
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = props.current;
    if (p.disabled || activePointer.current !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    if (isFull()) {
      notify();
      return;
    }
    const pt = toPoint(e);
    if (p.tool === "fill") {
      const s: Stroke = { tool: "fill", colour: p.colour, size: 1, points: [pt] };
      if (committed.current) drawStroke(context(committed.current), s);
      strokes.current.push(s);
      redoStack.current = [];
      requestPaint();
      notify();
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* some browsers throw for synthetic events */
    }
    activePointer.current = e.pointerId;
    current.current = {
      tool: p.tool,
      colour: p.tool === "eraser" ? ERASER_COLOUR : p.colour,
      size: p.size,
      points: [pt],
    };
    requestPaint();
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerId !== activePointer.current || !current.current) return;
    e.preventDefault();
    const native = e.nativeEvent;
    const events = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const list = events.length ? events : [native];
    const pts = current.current.points;
    for (const ev of list) {
      const pt = toPoint(ev);
      const last = pts[pts.length - 1];
      if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < MIN_DIST) continue;
      if (countPoints(strokes.current) + pts.length >= LIMITS.maxPoints - 1) break;
      pts.push(pt);
    }
    requestPaint();
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerId !== activePointer.current) return;
    finish();
  }

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="Drawing canvas"
    />
  );
});

function lastTime(strokes?: Stroke[]): number {
  if (!strokes?.length) return 0;
  const s = strokes[strokes.length - 1];
  return (s.points[s.points.length - 1]?.[2] ?? 0) + 500;
}
