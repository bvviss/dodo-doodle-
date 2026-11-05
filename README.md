# Doodle Chain 🎨

A drawing-and-guessing party game for friends, played in the web browser on
phones and laptops. No accounts, no app to install.

**How a game goes:** everyone writes a silly prompt. The prompts travel around
the group: the next person **draws** it, the next **guesses** the drawing, the
next **draws** that guess… At the end you watch every chain unravel, drawing by
drawing, and score points for accurate guesses.

- 3 to 10 players (6–10 is the sweet spot). You can add **bots** to fill gaps or to try it alone.
- The host shares a link (or a 4-letter code like `KNDR`).
- Works on phones and laptops, and in any modern browser.

---

## Contents

1. [Install Node.js (one time)](#1-install-nodejs-one-time)
2. [Run the game on your computer](#2-run-the-game-on-your-computer)
3. [Play with friends on the same wifi](#3-play-with-friends-on-the-same-wifi)
4. [Put it online for free (Cloudflare)](#4-put-it-online-for-free-cloudflare)
   - [Or: put it online on Vercel](#or-put-it-online-on-vercel)
5. [Change the game's name or web address](#5-change-the-games-name-or-web-address)
6. [Add your own words](#6-add-your-own-words)
7. [What does it cost?](#7-what-does-it-cost)
8. [Troubleshooting](#8-troubleshooting)
9. [For the curious: how it's built](#9-for-the-curious-how-its-built)

---

## 1. Install Node.js (one time)

Node.js is the free tool that builds and runs the game.

1. Go to **https://nodejs.org** and download the version marked **LTS**.
2. Open the downloaded file and click through the installer (the default options are fine).
3. Check it worked: open a **terminal**.
   - **Windows:** press the Windows key, type `PowerShell`, press Enter.
   - **Mac:** press ⌘ + Space, type `Terminal`, press Enter.

   Then type this and press Enter:

   ```bash
   node -v
   ```

   You should see something like `v22.11.0`. Any number 20 or higher is fine.
   If it says "command not found", restart your computer and try again.

## 2. Run the game on your computer

1. In the terminal, go into this project's folder. The easiest way: type `cd `
   (with a space after it), drag the project folder from your file browser into
   the terminal window, then press Enter.
2. Download the game's building blocks (only needed the first time, and after updates):

   ```bash
   npm install
   ```

3. Start the game:

   ```bash
   npm run dev
   ```

4. Open **http://localhost:5173** in your browser. 🎉

To try a whole game by yourself: create a room, click **🤖 Add bot** twice
(or more), then **▶ Start game**. Bots answer after a few seconds and guess
right about half the time.

To stop the game, click in the terminal and press **Ctrl + C**.

## 3. Play with friends on the same wifi

While testing at home, friends on the **same wifi** can join your computer:

```bash
npm run dev:wifi
```

The terminal now shows a **Network** address, like `http://192.168.1.23:5173`.
Friends open that address on their phones. (Your computer must stay on, and
some office or school networks block this — then put it online, below.)

## 4. Put it online for free (Cloudflare)

This gives you a real link like `https://doodle-chain.yourname.workers.dev`
that anyone can open from anywhere.

1. **Create a free Cloudflare account** at https://dash.cloudflare.com/sign-up
   (just an email and password; no credit card needed for the free plan).
2. In the terminal, inside the project folder, log in:

   ```bash
   npx wrangler login
   ```

   A browser window opens — click **Allow**. Come back to the terminal.
3. Put the game online:

   ```bash
   npm run deploy
   ```

   The first time, Cloudflare may ask you to pick a **workers.dev subdomain**
   (a short name for your account, e.g. `yourname`). Choose anything you like.
4. When it finishes, the terminal prints your link, for example:

   ```
   https://doodle-chain.yourname.workers.dev
   ```

   That's your game! Share it with your friends. You can also find it later in
   the Cloudflare dashboard under **Workers & Pages → doodle-chain**.

Whenever you change something (like adding words), just run `npm run deploy`
again to update the online version.

### Or: put it online on Vercel

Prefer Vercel? The game can run there completely, with no Cloudflare account.

**How it differs:** Vercel can't keep a live connection open to every phone,
so each phone checks in with the server about once a second, and the game is
kept in a small free database (**Upstash Redis**, added from inside Vercel).
Moves show up on other screens up to about a second later than on Cloudflare,
and the free database limits mean roughly a few dozen games a month — plenty
for a friend group.

1. Create a free account at https://vercel.com/signup and choose **Continue with GitHub**.
2. Click **Add New… → Project**, find **dodo-doodle-** and click **Import**, then **Deploy**.
   (Vercel reads the setup from `vercel.json`; you don't need to change anything.)
3. Add the database: open the project → **Storage** → **Create Database** →
   **Upstash for Redis** → pick the **Free** plan and the region closest to
   your friends (for Malaysia: **Singapore**) → **Create** → **Connect** to this project.
4. Go to **Deployments**, open the menu (⋯) on the newest one and click **Redeploy**,
   so the game picks up the database.
5. Open your link (like `https://dodo-doodle.vercel.app`) and play!

From then on, Vercel updates the game automatically every time the `main`
branch on GitHub changes.

To try the Vercel version on your computer (no database needed — it keeps
everything in memory):

```bash
npm run dev:vercel
```

## 5. Change the game's name or web address

Open **`wrangler.jsonc`** in any text editor (Notepad, TextEdit, VS Code…) and
change this line:

```jsonc
"name": "doodle-chain",
```

to something else, like `"name": "kopi-doodles",` (lowercase letters, numbers
and dashes only). After `npm run deploy` your game lives at
`https://kopi-doodles.yourname.workers.dev`. (The old address stops updating;
you can delete it in the Cloudflare dashboard.)

The title shown in the browser tab is in **`index.html`** (`<title>Doodle Chain</title>`).

## 6. Add your own words

**Without touching any code:** in the lobby, the host picks **📝 Custom** (or
**🔀 Mix**) under *Prompts* and pastes words, one per line (up to 500). The
list is remembered on the host's device for next time.

**To add words to the built-in packs for everyone:** open **`shared/words.ts`**.
You'll see packs like this:

```ts
{
  id: "food",
  name: "Food",
  easy: [ "pizza", "burger", "nasi lemak", ... ],
  hard: [ "char kway teow", "laksa", ... ],
},
```

Add your word in quotes followed by a comma, e.g. `"roti john",`, inside the
`easy` list (simple single things) or the `hard` list (trickier ideas or short
phrases). Keep each one under 60 characters. Then run the tests to check
nothing broke, and deploy:

```bash
npm test
```

```bash
npm run deploy
```

## 7. What does it cost?

**Nothing**, for a friend group. Everything runs on Cloudflare's free Workers plan:

- The free plan includes **100,000 Durable Object requests per day**. Each room
  is one Durable Object.
- Messages *from* players to the game count as **1 request per 20 messages**.
  A 10-player game sends a few thousand small messages (answers, drawing
  autosaves, "still here" pings), so one game uses roughly **100–200 requests**.
  That's hundreds of games per day before you'd hit the limit.
- If you ever did hit the limit, the game just stops working until the next
  day (UTC) — Cloudflare doesn't charge you on the free plan.

## 8. Troubleshooting

| Problem | Fix |
| --- | --- |
| `npm: command not found` | Node.js isn't installed or the terminal was opened before installing. Restart the terminal (or computer). |
| `npm install` shows red errors | Make sure you're inside the project folder (you should see `package.json` when you type `ls` or `dir`). |
| Port 5173 is already in use | Another copy is running. Close the other terminal, or press Ctrl + C there. |
| "Reconnecting…" banner | The internet blinked. It reconnects by itself; you land back in the same turn with your drawing restored. |
| "This game is already in progress" | New players can only join in the lobby. Wait for the host to press **Play again**. |
| `wrangler login` doesn't open a browser | Copy the link the terminal prints into your browser. |
| Vercel: "The game database isn't connected yet" | Do steps 3 and 4 of the Vercel section (add Upstash Redis, then Redeploy). |
| Vercel: moves feel a bit slow | That's the once-a-second check-in. Pick the database region closest to your friends; the game server runs in Singapore (`GAME_REGION` in `scripts/build-vercel.mjs`). |

## 9. For the curious: how it's built

| Part | What it is |
| --- | --- |
| `src/` | The website (React). `screens/` holds each screen; `canvas/` the drawing tools, replay and picture export. |
| `worker/room.ts` | The **referee**: rooms, turns, timers, bots, scoring. Plain TypeScript, so it can be tested without Cloudflare. |
| `worker/index.ts` | The Cloudflare Worker + one **Durable Object per room code** that holds the referee. |
| `server/` | The Vercel version of the game server: loads the referee from Upstash Redis on each check-in, then saves it. |
| `shared/` | Code used by both sides: message types (`types.ts`), rules and scoring (`rules.ts`), word packs (`words.ts`). |
| `tests/` | Automatic checks, including whole simulated games with bots and a fake clock. |

Useful commands:

```bash
npm test
```

```bash
npm run build
```

Rules in short:

- **Chains** always end on a guess. With N players a chain has N steps (one less if N is even), or 5/7 if the host shortens it.
- **Passing:** on turn *t*, the person in seat *s* works on chain *(s − t) mod N*, so nobody ever sees the same chain twice.
- **Scoring:** a guess is compared with the phrase its drawer was given. Exact = +100, close = +50, and the **drawer gets the same points** as the guesser. If a chain's last guess still matches the original prompt, everyone in that chain gets +50. Players can vote 👍 "close enough" on a miss during the reveal.
- **Modifiers** (optional): ⚡ Speed round (30 s), 🎨 Three colours, 🚫 No undo. New ones can be added in `shared/rules.ts` (`MODIFIERS`).

Planned for later (the code is laid out so these can be added): built-in voice
chat, GIF exports and shareable album links, more modifiers (blind draw, one
line, tiny canvas), shapes/stamps, and smarter synonym matching.
