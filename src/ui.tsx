// Small shared UI bits.

import { useEffect, useRef, useState } from "react";
import type { PublicPlayer } from "../shared/types";
import { client, useGame } from "./net";

export function Logo({ small = false }: { small?: boolean }) {
  const words = ["Doodle", "Chain"];
  return (
    <h1 className={small ? "logo logo-small" : "logo"} aria-label="Doodle Chain">
      {words.map((w, wi) => (
        <span key={wi} style={{ display: "inline-block", WebkitTextStroke: 0, textShadow: "none", transform: "none" }}>
          {[...w].map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
          {wi === 0 && <span className="gap"> </span>}
        </span>
      ))}
    </h1>
  );
}

export function Dot({ colour }: { colour: string }) {
  return <span className="dot" style={{ background: colour }} />;
}

/** Seconds left until a server-time deadline. Re-renders 4× a second. */
export function useSecondsLeft(deadline: number | null): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (deadline == null) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline == null) return null;
  return Math.max(0, Math.ceil((deadline - client.serverNow()) / 1000));
}

/** Calls `onZero` once when the countdown reaches zero. */
export function useOnDeadline(deadline: number | null, onZero: () => void) {
  const cb = useRef(onZero);
  cb.current = onZero;
  useEffect(() => {
    if (deadline == null) return;
    let fired = false;
    const id = setInterval(() => {
      if (!fired && client.serverNow() >= deadline) {
        fired = true;
        cb.current();
      }
    }, 200);
    return () => clearInterval(id);
  }, [deadline]);
}

export function Countdown({ deadline, noLimit = false }: { deadline: number | null; noLimit?: boolean }) {
  const s = useSecondsLeft(deadline);
  if (s == null) return null;
  const m = Math.floor(s / 60);
  const text = m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `${s}`;
  const cls = s <= 10 ? "countdown urgent" : noLimit ? "countdown calm" : "countdown";
  return (
    <div className={cls} role="timer" aria-label={`${s} seconds left`}>
      ⏱ {text}
    </div>
  );
}

export function TopBar({ label }: { label?: string }) {
  const { room } = useGame();
  if (!room) return null;
  const noLimit = room.phase === "draw" && room.settings.drawTime === 600 && !room.modifier?.drawTime;
  return (
    <div className="topbar">
      <span className="turn-pill">
        {label ?? `Turn ${room.turn + 1} of ${room.totalTurns}`}
      </span>
      <Countdown deadline={room.deadline} noLimit={noLimit} />
    </div>
  );
}

export function ConnectionBanner() {
  const { status, room } = useGame();
  if (!room || status === "open") return null;
  return <div className="conn-banner">📡 Reconnecting…</div>;
}

export function Toast() {
  const { toast } = useGame();
  if (!toast) return null;
  return (
    <div className="toast" role="status">
      {toast}
    </div>
  );
}

export function PlayerName({ player }: { player: PublicPlayer | undefined }) {
  if (!player) return <span>Someone</span>;
  return (
    <span className="row" style={{ gap: 6, display: "inline-flex" }}>
      <Dot colour={player.colour} />
      {player.name}
    </span>
  );
}

export function Floaters() {
  const { reactions, room } = useGame();
  return (
    <div className="floaters" aria-hidden>
      {reactions.map((r) => {
        const p = room?.players.find((x) => x.id === r.playerId);
        return (
          <div key={r.id} className="floater" style={{ left: `${r.x}%` }}>
            {r.emoji}
            {p && <small>{p.name}</small>}
          </div>
        );
      })}
    </div>
  );
}
