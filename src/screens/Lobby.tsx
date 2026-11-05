import { useEffect, useRef, useState } from "react";
import { LIMITS, type PackId, type Settings } from "../../shared/types";
import { chainLength, isValidCallLink, sanitizeCustomWords } from "../../shared/rules";
import { PACKS } from "../../shared/words";
import { client, useMe } from "../net";
import { storage } from "../storage";
import { Dot, Logo } from "../ui";
import { goTo } from "./Home";

function Seg<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.value)} type="button" className={o.value === value ? "on" : ""} disabled={disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Lobby() {
  const { room, me, isHost, playerId } = useMe();
  const [copied, setCopied] = useState(false);
  const [callDraft, setCallDraft] = useState(room?.settings.callLink ?? "");
  const [customText, setCustomText] = useState(() => storage.customWords());
  const customTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (room) setCallDraft(room.settings.callLink);
  }, [room?.settings.callLink]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!room) return null;
  const s = room.settings;
  const n = room.players.length;
  const canStart = n >= LIMITS.minPlayers;
  const inviteUrl = `${location.origin}/r/${room.code}`;

  function update(patch: Partial<Settings>, customWords?: string[]) {
    client.send({ type: "settings", settings: patch, customWords });
  }

  function setSource(src: Settings["promptSource"]) {
    const needsWords = (src === "custom" || src === "mix") && room!.customWordCount === 0 && customText.trim();
    update({ promptSource: src }, needsWords ? sanitizeCustomWords(customText) : undefined);
  }

  function onCustomChange(text: string) {
    setCustomText(text);
    storage.setCustomWords(text);
    if (customTimer.current) clearTimeout(customTimer.current);
    customTimer.current = setTimeout(() => update({}, sanitizeCustomWords(text)), 600);
  }

  function togglePack(id: PackId) {
    const has = s.packs.includes(id);
    if (has && s.packs.length === 1) return;
    update({ packs: has ? s.packs.filter((p) => p !== id) : [...s.packs, id] });
  }

  async function copyInvite() {
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: "Doodle Chain", text: `Join my Doodle Chain room ${room!.code}!`, url: inviteUrl });
        return;
      }
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this invite link:", inviteUrl);
    }
  }

  function leave() {
    client.leave();
    goTo("/");
  }

  const bots = room.players.filter((p) => p.isBot).length;
  const customCount = sanitizeCustomWords(customText).length;
  const callOk = callDraft.trim() === "" || isValidCallLink(callDraft.trim());

  return (
    <div className="app">
      <div className="row between" style={{ marginBottom: 14 }}>
        <Logo small />
        <button className="btn small" onClick={leave}>
          Leave
        </button>
      </div>

      <div className="lobby">
        <div className="stack">
          <div className="card yellow tilt-l">
            <div className="muted small" style={{ fontWeight: 800 }}>
              ROOM CODE
            </div>
            <div className="room-code">{room.code}</div>
            <button className="btn blue wide" onClick={copyInvite}>
              {copied ? "✅ Link copied!" : "🔗 Copy invite link"}
            </button>
            {s.callLink && (
              <a className="btn pink wide" style={{ marginTop: 10 }} href={s.callLink} target="_blank" rel="noopener noreferrer">
                🎧 Join voice call
              </a>
            )}
          </div>

          <div className="card tilt-r">
            <div className="row between">
              <h2 style={{ margin: 0 }}>Players</h2>
              <span className="tag">
                {n}/{LIMITS.maxPlayers}
              </span>
            </div>
            <ul className="players" style={{ marginTop: 12 }}>
              {room.players.map((p) => (
                <li key={p.id} className={`player ${p.connected ? "" : "off"}`}>
                  <Dot colour={p.colour} />
                  <span className="name">
                    {p.name}
                    {p.id === playerId && <span className="muted"> (you)</span>}
                  </span>
                  {p.id === room.hostId && <span title="Host">👑</span>}
                  {p.isBot && <span className="tag">bot</span>}
                  {!p.connected && <span className="tag">away</span>}
                  {isHost && p.id !== playerId && (
                    <button className="kick" title={`Remove ${p.name}`} aria-label={`Remove ${p.name}`} onClick={() => client.send({ type: "kick", playerId: p.id })}>
                      ✖
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {isHost && (
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn small" disabled={n >= LIMITS.maxPlayers} onClick={() => client.send({ type: "addBot" })}>
                  🤖 Add bot
                </button>
                <button className="btn small" disabled={bots === 0} onClick={() => client.send({ type: "removeBot" })}>
                  Remove bot
                </button>
              </div>
            )}
          </div>
          <div className="start-bar">
            {isHost ? (
              <button className="btn go big wide" disabled={!canStart} onClick={() => client.send({ type: "start" })}>
                {canStart ? `▶ Start game (${n} players)` : `Need ${LIMITS.minPlayers - n} more player${LIMITS.minPlayers - n === 1 ? "" : "s"} (add bots!)`}
              </button>
            ) : (
              <div className="card center-text" style={{ padding: 12 }}>
                <span className="wiggle">⏳</span> Waiting for {room.players.find((p) => p.id === room.hostId)?.name ?? "the host"} to start…
                {me && <div className="muted small">You're in as {me.name}</div>}
              </div>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="row between">
              <h2 style={{ margin: 0 }}>Settings</h2>
              {!isHost && <span className="muted small">Only the host can change these</span>}
            </div>

            <div className="setting">
              <span className="label">Prompts</span>
              <Seg
                value={s.promptSource}
                disabled={!isHost}
                onChange={setSource}
                options={[
                  { value: "player", label: "✍️ Players write" },
                  { value: "packs", label: "📦 Word packs" },
                  { value: "custom", label: "📝 Custom" },
                  { value: "mix", label: "🔀 Mix" },
                ]}
              />
            </div>

            {(s.promptSource === "packs" || s.promptSource === "mix") && (
              <div className="setting">
                <span className="label">Packs</span>
                <div className="seg">
                  {PACKS.map((p) => (
                    <button key={p.id} type="button" className={s.packs.includes(p.id) ? "on" : ""} disabled={!isHost} onClick={() => togglePack(p.id)}>
                      {p.emoji} {p.name}
                    </button>
                  ))}
                </div>
                <Seg
                  value={s.difficulty}
                  disabled={!isHost}
                  onChange={(v) => update({ difficulty: v })}
                  options={[
                    { value: "easy", label: "Easy" },
                    { value: "medium", label: "Medium" },
                    { value: "hard", label: "Hard" },
                  ]}
                />
              </div>
            )}

            {(s.promptSource === "custom" || s.promptSource === "mix") && (
              <div className="setting">
                <span className="label">Custom words ({room.customWordCount} in use)</span>
                {isHost ? (
                  <>
                    <textarea
                      className="input"
                      value={customText}
                      placeholder={"One per line, e.g.\nnasi lemak\nSam's car\nthe office printer"}
                      onChange={(e) => onCustomChange(e.target.value)}
                    />
                    <span className="muted small">
                      {customCount} words · max {LIMITS.maxCustomWords}, {LIMITS.maxText} letters each. Saved on this device.
                    </span>
                  </>
                ) : (
                  <span className="muted small">The host is using their own word list.</span>
                )}
              </div>
            )}

            <div className="setting">
              <span className="label">Prompt timer</span>
              <Seg
                value={s.promptTime}
                disabled={!isHost}
                onChange={(v) => update({ promptTime: v })}
                options={[30, 45, 60].map((v) => ({ value: v as Settings["promptTime"], label: `${v}s` }))}
              />
            </div>
            <div className="setting">
              <span className="label">Draw timer</span>
              <Seg
                value={s.drawTime}
                disabled={!isHost}
                onChange={(v) => update({ drawTime: v })}
                options={[
                  { value: 45 as const, label: "45s" },
                  { value: 75 as const, label: "75s" },
                  { value: 120 as const, label: "120s" },
                  { value: 600 as const, label: "No limit" },
                ]}
              />
            </div>
            <div className="setting">
              <span className="label">Guess timer</span>
              <Seg
                value={s.guessTime}
                disabled={!isHost}
                onChange={(v) => update({ guessTime: v })}
                options={[25, 40, 60].map((v) => ({ value: v as Settings["guessTime"], label: `${v}s` }))}
              />
            </div>
            <div className="setting">
              <span className="label">Chain length</span>
              <Seg
                value={s.chainLength}
                disabled={!isHost}
                onChange={(v) => update({ chainLength: v })}
                options={[
                  { value: 0 as const, label: `Full circle (${chainLength(Math.max(n, 3), 0)} steps)` },
                  { value: 5 as const, label: "5 steps" },
                  { value: 7 as const, label: "7 steps" },
                ]}
              />
            </div>
            <div className="setting">
              <span className="label">Round modifiers</span>
              <Seg
                value={s.modifiers}
                disabled={!isHost}
                onChange={(v) => update({ modifiers: v })}
                options={[
                  { value: "off", label: "Off" },
                  { value: "random", label: "🎲 Random" },
                ]}
              />
              <span className="muted small">Random: some draw turns become ⚡ Speed round, 🎨 Three colours or 🚫 No undo.</span>
            </div>
            <div className="setting">
              <span className="label">Voice call link (optional)</span>
              {isHost ? (
                <>
                  <input
                    className="input"
                    value={callDraft}
                    placeholder="https://discord.gg/… or WhatsApp / Meet link"
                    inputMode="url"
                    onChange={(e) => setCallDraft(e.target.value)}
                    onBlur={() => callOk && update({ callLink: callDraft.trim() })}
                    onKeyDown={(e) => e.key === "Enter" && callOk && update({ callLink: callDraft.trim() })}
                  />
                  {!callOk && <span className="small" style={{ color: "var(--red)", fontWeight: 800 }}>Links must start with https://</span>}
                </>
              ) : (
                <span className="muted small">{s.callLink ? "The host shared a call link (button on the left)." : "None yet."}</span>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
