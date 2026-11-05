import { useGame } from "../net";
import { Dot, TopBar } from "../ui";

export function Waiting() {
  const { room, playerId } = useGame();
  if (!room) return null;
  const players = room.players;
  const done = players.filter((p) => p.done || !p.connected).length;
  const last = room.turn + 1 >= room.totalTurns;
  return (
    <div className="app play stack">
      <TopBar />
      <div className="card yellow tilt-l center-text">
        <div className="big-number">
          <span className="wiggle">⏳</span>
        </div>
        <h2 style={{ marginTop: 8 }}>Waiting for others</h2>
        <div style={{ fontFamily: "var(--head)", fontSize: 28 }}>
          {done}/{players.length} done
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          {last ? "That was the last turn — the reveal is next! 🎉" : "Next turn starts as soon as everyone is done."}
        </p>
      </div>
      <div className="waiting-grid">
        {players.map((p) => (
          <div key={p.id} className={`player ${p.done ? "done" : ""} ${p.connected ? "" : "off"}`}>
            <Dot colour={p.colour} />
            <span className="name">
              {p.name}
              {p.id === playerId && " (you)"}
            </span>
            <span aria-label={p.done ? "done" : "still working"}>{p.done ? "✅" : p.connected ? "✏️" : "💤"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
