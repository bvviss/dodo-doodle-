// Drawing toolbar: tools, sizes, palette, undo/redo/clear.

import { useEffect, useState } from "react";
import { PEN_SIZES, type Tool } from "../../shared/types";

interface Props {
  tool: Tool;
  colour: string;
  size: number;
  palette: readonly string[];
  /** "No undo" modifier: hides undo/redo/eraser/clear. */
  noUndo: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onTool: (t: Tool) => void;
  onColour: (c: string) => void;
  onSize: (s: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

export function Toolbar(p: Props) {
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!confirmClear) return;
    const id = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(id);
  }, [confirmClear]);

  // Keyboard shortcuts for laptops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        if (p.noUndo) return;
        if (e.shiftKey) p.onRedo();
        else p.onUndo();
      } else if ((e.ctrlKey || e.metaKey) && k === "y") {
        e.preventDefault();
        if (!p.noUndo) p.onRedo();
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (k === "b" || k === "p") p.onTool("pen");
        else if (k === "e" && !p.noUndo) p.onTool("eraser");
        else if (k === "f" || k === "g") p.onTool("fill");
        else if (k >= "1" && k <= "4") p.onSize(PEN_SIZES[Number(k) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  const few = p.palette.length <= 4;
  const sizeLabel = (s: number) => ["Small", "Medium", "Large", "Huge"][PEN_SIZES.indexOf(s as (typeof PEN_SIZES)[number])] ?? `${s}`;

  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="tool-row">
      <div className="tool-group">
        <button className={`tool-btn ${p.tool === "pen" ? "on" : ""}`} title="Pen (B)" aria-label="Pen" aria-pressed={p.tool === "pen"} onClick={() => p.onTool("pen")}>
          ✏️
        </button>
        {!p.noUndo && (
          <button className={`tool-btn ${p.tool === "eraser" ? "on" : ""}`} title="Eraser (E)" aria-label="Eraser" aria-pressed={p.tool === "eraser"} onClick={() => p.onTool("eraser")}>
            🧽
          </button>
        )}
        <button className={`tool-btn ${p.tool === "fill" ? "on" : ""}`} title="Fill bucket (F)" aria-label="Fill bucket" aria-pressed={p.tool === "fill"} onClick={() => p.onTool("fill")}>
          🪣
        </button>
      </div>

      <div className="divider" />

      <div className="tool-group" aria-label="Brush size">
        {PEN_SIZES.map((s) => {
          const px = Math.max(5, Math.round(s * 0.75));
          return (
            <button
              key={s}
              className={`tool-btn ${p.size === s ? "on" : ""}`}
              title={`${sizeLabel(s)} brush`}
              aria-label={`${sizeLabel(s)} brush`}
              aria-pressed={p.size === s}
              disabled={p.tool === "fill"}
              onClick={() => p.onSize(s)}
            >
              <span className="size-dot" style={{ width: px, height: px, background: p.tool === "eraser" ? "#b9aea5" : p.colour === "#ffffff" ? "#ddd" : p.colour }} />
            </button>
          );
        })}
      </div>

      {!p.noUndo && (
        <>
          <div className="divider" />
          <div className="tool-group">
            <button className="tool-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!p.canUndo} onClick={p.onUndo}>
              ↩️
            </button>
            <button className="tool-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!p.canRedo} onClick={p.onRedo}>
              ↪️
            </button>
            <button
              className={`tool-btn ${confirmClear ? "on" : ""}`}
              style={confirmClear ? { width: "auto", padding: "0 10px", fontSize: 14, fontWeight: 800, background: "var(--red)", color: "#fff" } : undefined}
              title="Clear everything"
              aria-label={confirmClear ? "Tap again to clear" : "Clear"}
              disabled={!p.canUndo && !confirmClear}
              onClick={() => {
                if (confirmClear) {
                  setConfirmClear(false);
                  p.onClear();
                } else setConfirmClear(true);
              }}
            >
              {confirmClear ? "Clear all?" : "🗑️"}
            </button>
          </div>
        </>
      )}

      </div>

      <div className={`palette ${few ? "few" : ""}`} role="radiogroup" aria-label="Colours" style={{ flexBasis: few ? undefined : "100%", justifyContent: "center" }}>
        {p.palette.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={p.colour === c}
            aria-label={`Colour ${c}`}
            className={p.colour === c && p.tool !== "eraser" ? "on" : ""}
            style={{ background: c }}
            onClick={() => {
              p.onColour(c);
              if (p.tool === "eraser") p.onTool("pen");
            }}
          />
        ))}
      </div>
    </div>
  );
}
