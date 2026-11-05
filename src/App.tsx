import { useEffect, useState } from "react";
import { ROOM_CODE_RE } from "../shared/types";
import { client, useGame } from "./net";
import { storage } from "./storage";
import { Home } from "./screens/Home";
import { Lobby } from "./screens/Lobby";
import { ConnectionBanner, Floaters, Toast } from "./ui";

function codeFromPath(): string | null {
  const m = location.pathname.match(/^\/r\/([A-Za-z]{4})\/?$/);
  const code = m ? m[1].toUpperCase() : null;
  return code && ROOM_CODE_RE.test(code) ? code : null;
}

export function App() {
  const [urlCode, setUrlCode] = useState(codeFromPath);
  const game = useGame();

  useEffect(() => {
    const onPop = () => setUrlCode(codeFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Coming back to a room link we were already in (refresh, wifi drop): rejoin automatically.
  useEffect(() => {
    if (!urlCode || game.status !== "idle" || game.fatal) return;
    const session = storage.session();
    const profile = storage.profile();
    if (session?.code === urlCode && profile) client.join(urlCode, profile.name, profile.colour);
  }, [urlCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the room page (browser back) closes the connection.
  useEffect(() => {
    if (!urlCode && game.code) client.leave();
  }, [urlCode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <ConnectionBanner />
      <Screen urlCode={urlCode} />
      <Floaters />
      <Toast />
    </>
  );
}

function Screen({ urlCode }: { urlCode: string | null }) {
  const { room, status } = useGame();
  if (!room) {
    if (status === "connecting" || status === "reconnecting") {
      return (
        <div className="app center-text" style={{ paddingTop: 80 }}>
          <div className="big-number wiggle">✏️</div>
          <h2>Joining room {urlCode}…</h2>
        </div>
      );
    }
    return <Home urlCode={urlCode} />;
  }
  switch (room.phase) {
    case "lobby":
      return <Lobby />;
    default:
      return (
        <div className="app center-text" style={{ paddingTop: 80 }}>
          <h2>The game has started!</h2>
          <p className="muted">Game screens arrive in the next milestone.</p>
        </div>
      );
  }
}
