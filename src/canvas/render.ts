// The one stroke renderer used everywhere: drawing, guess screen, replay and PNG export.
// Always renders onto an 800×600 canvas so drawings look identical on every device.

import { getStroke } from "perfect-freehand";
import { CANVAS_H, CANVAS_W, ERASER_COLOUR, type Stroke } from "../../shared/types";
import { floodFill } from "./fill";

export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w = CANVAS_W, h = CANVAS_H): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function context(canvas: HTMLCanvasElement): Ctx {
  // willReadFrequently: flood fill reads pixels back.
  return canvas.getContext("2d", { willReadFrequently: true })!;
}

export function clearCanvas(ctx: Ctx): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.restore();
}

function outline(stroke: Stroke, count: number, complete: boolean): number[][] {
  const pts = stroke.points.slice(0, count).map((p) => [p[0], p[1]]);
  return getStroke(pts, {
    size: stroke.size,
    thinning: stroke.tool === "eraser" ? 0 : 0.35,
    smoothing: 0.5,
    streamline: 0.35,
    simulatePressure: stroke.tool !== "eraser",
    last: complete,
  });
}

/**
 * Draw one stroke. `count` limits how many points are drawn (for replay).
 * Fill strokes do a flood fill on the pixels already on the canvas.
 */
export function drawStroke(ctx: Ctx, stroke: Stroke, complete = true, count = stroke.points.length): void {
  if (count <= 0 || !stroke.points.length) return;
  if (stroke.tool === "fill") {
    const [x, y] = stroke.points[0];
    floodFill(ctx, x, y, stroke.colour);
    return;
  }
  const colour = stroke.tool === "eraser" ? ERASER_COLOUR : stroke.colour;
  ctx.fillStyle = colour;
  const pts = stroke.points.slice(0, count);
  const first = pts[0];
  // A tap (or a stroke that never moved) is a dot.
  if (pts.every((p) => Math.abs(p[0] - first[0]) < 1 && Math.abs(p[1] - first[1]) < 1)) {
    ctx.beginPath();
    ctx.arc(first[0], first[1], Math.max(1, stroke.size / 2), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const poly = outline(stroke, count, complete);
  if (poly.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  ctx.closePath();
  ctx.fill();
}

/** Clear to white and draw all strokes in order. */
export function renderAll(ctx: Ctx, strokes: Stroke[]): void {
  clearCanvas(ctx);
  for (const s of strokes) drawStroke(ctx, s, true);
}

export function countPoints(strokes: Stroke[]): number {
  let n = 0;
  for (const s of strokes) n += s.points.length;
  return n;
}
