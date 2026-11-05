// Tiny localStorage helpers. Storage can be unavailable (private mode), so
// every access is wrapped and the game still works without it.

export interface Profile {
  name: string;
  colour: string;
}
export interface Session {
  code: string;
  token: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const storage = {
  profile: () => read<Profile>("dc.profile"),
  setProfile: (p: Profile) => write("dc.profile", p),
  session: () => read<Session>("dc.session"),
  setSession: (s: Session | null) => write("dc.session", s),
  customWords: () => read<string>("dc.customWords") ?? "",
  setCustomWords: (text: string) => write("dc.customWords", text),
};
