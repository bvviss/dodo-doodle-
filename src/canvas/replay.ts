// Stroke-by-stroke replay timing: pauses longer than 300 ms are squashed to
// 300 ms, then everything is sped up so any drawing finishes in ~5 seconds.

import type { Stroke } from "../../shared/types";

export const MAX_PAUSE_MS = 300;
export const REPLAY_MS = 5000;

export interface Timeline {
  /** For each event: stroke index, number of points shown, and time (ms from replay start). */
  stroke: Int32Array;
  count: Int32Array;
  time: Float64Array;
  duration: number;
}

export function buildTimeline(strokes: Stroke[], target = REPLAY_MS): Timeline {
  let n = 0;
  for (const s of strokes) n += s.points.length;
  const stroke = new Int32Array(n);
  const count = new Int32Array(n);
  const time = new Float64Array(n);
  let k = 0;
  let rawPrev = 0;
  let t = 0;
  strokes.forEach((s, si) => {
    s.points.forEach((p, pi) => {
      const gap = Math.max(0, p[2] - rawPrev);
      rawPrev = Math.max(rawPrev, p[2]);
      // Squash pauses; give each new stroke at least a short beat.
      t += Math.min(gap, MAX_PAUSE_MS) + (pi === 0 && si > 0 ? 40 : 0);
      stroke[k] = si;
      count[k] = pi + 1;
      time[k] = t;
      k++;
    });
  });
  const total = n ? time[n - 1] : 0;
  const scale = total > target ? target / total : 1;
  for (let i = 0; i < n; i++) time[i] *= scale;
  return { stroke, count, time, duration: total * scale };
}
