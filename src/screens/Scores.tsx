import { useEffect, useRef, useState } from "react";
import { renderChainPng, saveBlob } from "../canvas/exportPng";
import { client, useMe } from "../net";
import { Dot, Logo } from "../ui";
import { ReactionBar } from "./Reveal";

export function Scores() {
  const { room, chains, isHost, playerId } = useMe();
  const [busy, setBusy] = useState<number | null>(null);
  const asked = useRef(new Set<number>());

  const chainCount = room?.reveal?.chainCount ?? 0;

  // Fetch every chain once with its final results (votes included), and any we missed after a refresh.
  useEffect(() => {
    for (let i = 0; i < chainCount; i++) {
      if (asked.current.has(i)) continue;
      asked.current.add(i);
      client.send({ type: "getChain", chain: i });
    }
  }, [chainCount]);

  if (!room || !room.scores) return null;
  const scores = room.scores;
  const player = (id: string) => room.players.find((p) => p.id === id);
  const top = scores[0]?.points ?? 0;
  const winners = scores.filter((s) => s.points === top && top > 0).map((s) => player(s.playerId)?.name ?? "?");

  async function download(i: number) {
    const chain = chains[i];
    if (!chain) return;
    setBusy(i);
    try {
      const owner = player(chain.ownerId);
      const blob = await renderChainPng({
        title: `Chain ${i + 1} — started by ${owner?.name ?? "someone"} · room ${room!.code}`,
        steps: chain.steps,
        colourOf: (id) => player(id)?.colour ?? "#cccccc",
        matchOf: (si) => {
          const s = chain.steps[si];
          return s && s.kind === "guess" ? s.match : null;
        },
      });
      await saveBlob(blob, `doodle-chain-${room!.code}-chain-${i + 1}.png`);
    } catch (err) {
      console.error(err);
      client.showToast("Couldn't make the picture, sorry!");
    } finally {
      setBusy(null);
    }
  }

  let rank = 0;
  let lastPts = -1;

  return (
    <div className="app scores stack">
      <Logo small />
      <div className="card yellow tilt-l center-text">
        <div className="big-number">🏆</div>
        <h2 style={{ margin: "8px 0 0" }}>
          {winners.length === 0 ? "Nobody scored… art is hard!" : winners.length === 1 ? `${winners[0]} wins!` : `It's a tie: ${winners.join(" & ")}!`}
        </h2>
      </div>

      <div className="scoreboard">
        {scores.map((s, i) => {
          if (s.points !== lastPts) {
            rank = i + 1;
            lastPts = s.points;
          }
          const p = player(s.playerId);
          const isWinner = s.points === top && top > 0;
          return (
            <div key={s.playerId} className={`score-row ${isWinner ? "winner" : ""}`}>
              <div className="rank">{isWinner ? "👑" : rank}</div>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                  <Dot colour={p?.colour ?? "#ccc"} />
                  <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p?.name ?? "Someone"}
                    {s.playerId === playerId && " (you)"}
                  </strong>
                  {p?.isBot && <span className="tag">bot</span>}
                </div>
                <div className="detail">
                  🎯 {s.exact} exact · 👌 {s.close} close{s.chainBonus ? ` · 🔗 +${s.chainBonus} bonus` : ""}
                </div>
              </div>
              <div className="pts">{s.points}</div>
            </div>
          );
        })}
      </div>

      <ReactionBar />

      <div className="card">
        <h2>📸 Album</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Save any chain as a picture to share in the group chat.
        </p>
        <div className="album-list">
          {Array.from({ length: chainCount }, (_, i) => {
            const c = chains[i];
            const owner = c ? player(c.ownerId) : undefined;
            const first = c?.steps[0];
            const last = c?.steps[c.steps.length - 1];
            return (
              <div key={i} className="album-item">
                <Dot colour={owner?.colour ?? "#ccc"} />
                <div className="grow">
                  <div className="ellipsis" style={{ fontWeight: 800 }}>
                    {first && first.kind === "prompt" ? first.text : `Chain ${i + 1}`}
                  </div>
                  <div className="ellipsis muted small">
                    {owner?.name ?? "…"}
                    {last && last.kind === "guess" ? ` → “${last.text}”` : ""}
                  </div>
                </div>
                <button className="btn small blue" disabled={!c || busy !== null} onClick={() => download(i)}>
                  {busy === i ? "…" : "⬇ PNG"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {isHost ? (
        <button className="btn go big wide" onClick={() => client.send({ type: "playAgain" })}>
          🔁 Play again
        </button>
      ) : (
        <div className="card center-text" style={{ padding: 12 }}>
          The host can start another round with the same group.
        </div>
      )}
    </div>
  );
}
