// Album export: renders one chain as a tall PNG (title + a card per step,
// drawings at 400×300) and downloads or shares it. Works on phones.

import type { Match, Step } from "../../shared/types";
import { context, makeCanvas, renderAll } from "./render";

const W = 480;
const PAD = 20;
const CARD_W = W - PAD * 2;
const SCALE = 2; // crisp on retina screens
const INK = "#231f20";

const HEAD = '600 26px "Fredoka", "Nunito", sans-serif';
const TEXT = '600 22px "Fredoka", "Nunito", sans-serif';
const SMALL = '800 14px "Nunito", sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > max && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function card(ctx: CanvasRenderingContext2D, y: number, h: number, fill: string) {
  ctx.fillStyle = INK;
  roundRect(ctx, PAD + 5, y + 5, CARD_W, h, 14);
  ctx.fill();
  ctx.fillStyle = fill;
  roundRect(ctx, PAD, y, CARD_W, h, 14);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

const BADGE: Record<Match, [string, string]> = {
  exact: ["EXACT", "#2ec27e"],
  close: ["CLOSE", "#ffd23f"],
  miss: ["MISS", "#e7ddd3"],
};

export interface AlbumInput {
  title: string;
  steps: Step[];
  colourOf: (playerId: string) => string;
  matchOf: (stepIndex: number) => Match | null;
}

export async function renderChainPng({ title, steps, colourOf, matchOf }: AlbumInput): Promise<Blob> {
  try {
    await document.fonts?.ready;
  } catch {
    /* ignore */
  }
  // Measure first.
  const measure = context(makeCanvas(10, 10));
  const heights = steps.map((s) => {
    if (s.kind === "drawing") return 40 + 300 + 16;
    measure.font = TEXT;
    const lines = wrap(measure, s.text, CARD_W - 32).length;
    return 46 + lines * 28 + 14;
  });
  const height = 90 + heights.reduce((a, b) => a + b + 18, 0) + 40;

  const canvas = makeCanvas(W * SCALE, height * SCALE);
  const ctx = context(canvas);
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#fff4e0";
  ctx.fillRect(0, 0, W, height);

  // Title
  ctx.fillStyle = INK;
  ctx.font = HEAD;
  ctx.textBaseline = "top";
  ctx.fillText("Doodle Chain", PAD, 18);
  ctx.font = SMALL;
  ctx.fillStyle = "#6f625a";
  ctx.fillText(title, PAD, 52);

  const art = makeCanvas();
  const artCtx = context(art);
  let y = 90;
  steps.forEach((s, i) => {
    const h = heights[i];
    card(ctx, y, h, s.kind === "prompt" ? "#fff1b8" : "#fffdf8");
    // author line
    ctx.fillStyle = colourOf(s.authorId);
    ctx.beginPath();
    ctx.arc(PAD + 22, y + 22, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = SMALL;
    const label = s.kind === "prompt" ? "wrote" : s.kind === "drawing" ? "drew" : "guessed";
    ctx.fillText(`${s.authorName} ${label}`, PAD + 38, y + 14);

    if (s.kind === "drawing") {
      renderAll(artCtx, s.strokes);
      ctx.drawImage(art, PAD + 16, y + 40, CARD_W - 32, ((CARD_W - 32) * 3) / 4);
      ctx.lineWidth = 2;
      ctx.strokeRect(PAD + 16, y + 40, CARD_W - 32, ((CARD_W - 32) * 3) / 4);
    } else {
      ctx.font = TEXT;
      wrap(ctx, s.text, CARD_W - 32).forEach((line, li) => ctx.fillText(line, PAD + 16, y + 44 + li * 28));
      const m = s.kind === "guess" ? matchOf(i) : null;
      if (m) {
        const [txt, col] = BADGE[m];
        ctx.font = SMALL;
        const bw = ctx.measureText(txt).width + 18;
        const bx = PAD + CARD_W - bw - 12;
        ctx.fillStyle = col;
        roundRect(ctx, bx, y + 10, bw, 24, 12);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = m === "exact" ? "#fff" : INK;
        ctx.fillText(txt, bx + 9, y + 15);
      }
    }
    y += h + 18;
  });

  ctx.font = SMALL;
  ctx.fillStyle = "#6f625a";
  ctx.fillText(location.host, PAD, height - 28);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG failed"))), "image/png"));
}

/** Save a blob: share sheet on phones (so it can go to Photos), download elsewhere. */
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: "image/png" });
  const touch = matchMedia("(pointer: coarse)").matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Doodle Chain" });
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
