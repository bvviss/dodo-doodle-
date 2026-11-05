// Flood fill (paint bucket) on canvas pixels, with a colour tolerance so the
// soft anti-aliased edges of lines don't leave a gappy halo.

import type { Ctx } from "./render";

export const FILL_TOLERANCE = 48;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function floodFill(ctx: Ctx, sx: number, sy: number, hex: string, tolerance = FILL_TOLERANCE): void {
  const { width: w, height: h } = ctx.canvas;
  const x0 = Math.min(w - 1, Math.max(0, Math.round(sx)));
  const y0 = Math.min(h - 1, Math.max(0, Math.round(sy)));
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const start = (y0 * w + x0) * 4;
  const tr = d[start];
  const tg = d[start + 1];
  const tb = d[start + 2];
  const [fr, fg, fb] = hexToRgb(hex);
  if (Math.abs(tr - fr) <= 2 && Math.abs(tg - fg) <= 2 && Math.abs(tb - fb) <= 2) return;

  const seen = new Uint8Array(w * h);
  const matches = (i: number) => {
    const p = i * 4;
    return Math.abs(d[p] - tr) <= tolerance && Math.abs(d[p + 1] - tg) <= tolerance && Math.abs(d[p + 2] - tb) <= tolerance;
  };
  const paint = (i: number) => {
    const p = i * 4;
    d[p] = fr;
    d[p + 1] = fg;
    d[p + 2] = fb;
    d[p + 3] = 255;
    seen[i] = 1;
  };

  // Scanline fill.
  const stack: number[] = [x0, y0];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    let i = y * w + x;
    while (x >= 0 && !seen[i] && matches(i)) {
      x--;
      i--;
    }
    x++;
    i++;
    let up = false;
    let down = false;
    while (x < w && !seen[i] && matches(i)) {
      paint(i);
      if (y > 0) {
        const j = i - w;
        if (!seen[j] && matches(j)) {
          if (!up) {
            stack.push(x, y - 1);
            up = true;
          }
        } else up = false;
      }
      if (y < h - 1) {
        const j = i + w;
        if (!seen[j] && matches(j)) {
          if (!down) {
            stack.push(x, y + 1);
            down = true;
          }
        } else down = false;
      }
      x++;
      i++;
    }
  }

  // Grow the fill by one pixel into the anti-aliased edge so there's no white halo.
  const grown: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (seen[i]) continue;
      if ((x > 0 && seen[i - 1]) || (x < w - 1 && seen[i + 1]) || (y > 0 && seen[i - w]) || (y < h - 1 && seen[i + w])) {
        grown.push(i);
      }
    }
  }
  for (const i of grown) {
    const p = i * 4;
    // Blend: keep dark line pixels dark, cover light halo pixels.
    const lum = (d[p] + d[p + 1] + d[p + 2]) / 3;
    const t = lum / 255;
    d[p] = Math.round(d[p] * (1 - t) + fr * t);
    d[p + 1] = Math.round(d[p + 1] * (1 - t) + fg * t);
    d[p + 2] = Math.round(d[p + 2] * (1 - t) + fb * t);
  }
  ctx.putImageData(img, 0, 0);
}
