import { useEffect, useRef } from "react";
import { REACTIONS, type Match, type PublicPlayer, type Step } from "../../shared/types";
import { chainSurvived } from "../../shared/rules";
import { StrokeView } from "../canvas/StrokeView";
import { client, useMe } from "../net";
import { Dot } from "../ui";

export function ReactionBar() {
  return (
    <div className="reactions" aria-label="Reactions">
      {REACTIONS.map((e) => (
        <button key={e} onClick={() => client.send({ type: "react", emoji: e })} aria-label={`React ${e}`}>
          {e}
        </button>
      ))}
    </div>
  );
}

export function MatchBadge({ match }: { match: Match }) {
  const label = match === "exact" ? "Exact! +100" : match === "close" ? "Close +50" : "Miss";
  return <span className={`badge ${match}`}>{label}</span>;
}

function Author({ player, name, verb }: { player?: PublicPlayer; name: string; verb: string }) {
  return (
    <div className="author">
      <Dot colour={player?.colour ?? "#ccc"} />
      <span>
        {player?.name ?? name} <span className="muted">{verb}</span>
      </span>
    </div>
  );
}

/** Steps with live match/vote info from room.revealMatches applied. */
export function withMatches(steps: Step[], matches: { step: number; match: Match; votes: string[] }[]): Step[] {
  return steps.map((s, i) => {
    const m = matches.find((x) => x.step === i);
    return m && s.kind === "guess" ? { ...s, match: m.match, votes: m.votes } : s;
  });
}

export function Reveal() {
  const { room, chains, isHost, playerId } = useMe();
  const bottom = useRef<HTMLDivElement>(null);
  const asked = useRef<string>("");

  const r = room?.reveal ?? null;
  const cached = r ? chains[r.chain] : undefined;
  const visibleCount = r ? r.step + 1 : 0;
  const rawSteps = cached ? cached.steps.slice(0, visibleCount) : [];
  const missing = !!r && (rawSteps.length < visibleCount || rawSteps.some((s) => !s));

  // If we somehow missed a step (e.g. after a reconnect), ask for the chain.
  useEffect(() => {
    if (!r || !missing) return;
    const key = `${r.chain}:${r.step}`;
    if (asked.current === key) return;
    asked.current = key;
    client.send({ type: "getChain", chain: r.chain });
  }, [r, missing]);

  // Scroll the newest card into view.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [r?.chain, r?.step, rawSteps.length]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [r?.chain]);

  if (!room || !r) return null;
  const steps = withMatches(rawSteps.filter(Boolean), room.revealMatches);
  const player = (id: string) => room.players.find((p) => p.id === id);
  const owner = player(r.owners[r.chain]);
  const chainDone = r.step >= r.chainLength - 1 && steps.length === r.chainLength;
  const lastChain = r.chain >= r.chainCount - 1;
  const first = steps[0];
  const final = steps[steps.length - 1];
  const host = player(room.hostId ?? "");

  return (
    <div className="app reveal">
      <div className="reveal-head">
        <span className="turn-pill">
          Chain {r.chain + 1} of {r.chainCount}
        </span>
        <h2 style={{ marginTop: 10 }}>Started by {owner?.name ?? "someone"}</h2>
      </div>

      <div className="feed">
        {steps.map((s, i) => {
          if (s.kind === "prompt") {
            return (
              <div key={i} className="step-card prompt">
                <Author player={player(s.authorId)} name={s.authorName} verb="wrote" />
                <div className="step-text">{s.text}</div>
              </div>
            );
          }
          if (s.kind === "drawing") {
            return (
              <div key={i} className="step-card">
                <Author player={player(s.authorId)} name={s.authorName} verb="drew" />
                {s.strokes.length ? (
                  <StrokeView strokes={s.strokes} replay label={`Drawing by ${s.authorName}`} />
                ) : (
                  <div className="canvas-frame" style={{ display: "grid", placeItems: "center" }}>
                    <span className="muted" style={{ fontWeight: 800 }}>
                      (blank — ran out of time 🙈)
                    </span>
                  </div>
                )}
                <div className="muted small center-text" style={{ marginTop: 6 }}>
                  {s.strokes.length ? "Tap the drawing to replay" : ""}
                </div>
              </div>
            );
          }
          const canVote = s.autoMatch === "miss" && s.authorId !== playerId && s.text !== "???";
          const voted = !!playerId && s.votes.includes(playerId);
          return (
            <div key={i} className="step-card">
              <div className="row between">
                <Author player={player(s.authorId)} name={s.authorName} verb="guessed" />
                <MatchBadge match={s.match} />
              </div>
              <div className="step-text">{s.text}</div>
              {s.autoMatch === "miss" && (
                <div className="row" style={{ marginTop: 8 }}>
                  {canVote ? (
                    <button className={`btn small ${voted ? "on" : ""}`} onClick={() => client.send({ type: "vote", chain: r.chain, step: i })}>
                      👍 Close enough{s.votes.length ? ` (${s.votes.length})` : ""}
                    </button>
                  ) : (
                    s.votes.length > 0 && <span className="muted small vote">👍 {s.votes.length} vote{s.votes.length > 1 ? "s" : ""}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {chainDone && first?.kind === "prompt" && final?.kind === "guess" && (
          <div className="step-card" style={{ background: chainSurvived(steps) ? "#d8f6e6" : "#ffe1ec" }}>
            <div className="compare">
              <div>
                <div className="muted small">Started as</div>
                <div className="step-text">{first.text}</div>
              </div>
              <div className="arrow">➡️</div>
              <div>
                <div className="muted small">Ended as</div>
                <div className="step-text">{final.text}</div>
              </div>
            </div>
            <div className="center-text" style={{ marginTop: 8, fontWeight: 800 }}>
              {chainSurvived(steps) ? "🎉 It survived the whole chain! +50 for everyone in it" : "😂 Lost in translation!"}
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="reveal-actions">
        <div className="inner">
          <ReactionBar />
          {isHost ? (
            <button className="btn go big" onClick={() => client.send({ type: "revealNext" })}>
              {!chainDone ? "Next ▶" : lastChain ? "See scores 🏆" : "Next chain ▶"}
            </button>
          ) : (
            <div className="turn-pill">⏳ Waiting for {host?.name ?? "host"}…</div>
          )}
        </div>
      </div>
    </div>
  );
}
