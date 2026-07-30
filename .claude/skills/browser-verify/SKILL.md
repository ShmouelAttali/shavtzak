---
name: browser-verify
description: Verify a shavtzak change in a REAL Chrome window signed in as the owner (elyashivlavi@gmail.com) — launch the dev servers, open an isolated-but-authenticated Chrome via a copy of his profile, and drive/inspect it over CDP with Playwright. Use whenever the owner says yes to "verify in the browser?", or asks to see/screenshot a change in the actual app rather than in tests.
---

# Manual browser verification

Ask the owner first (CLAUDE.md rule). Then: servers → Chrome → drive → report →
leave it open for him.

## 1. Dev servers

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN; lsof -nP -iTCP:5173 -sTCP:LISTEN   # ALWAYS check first
npm run dev:api    # 3001
npm run dev        # 5173, proxies /api → 3001
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/soldiers   # expect 200
```

**If a port is already taken it is probably the owner's own server — never kill
it**; either reuse it (fine for read-only checks of *his* code, useless for
verifying *yours*) or run yours on a free port (`npx vite --port 5199
--strictPort`, and point the proxy at your own API port).

⚠ **Local dev writes to PRODUCTION data.** `.env` holds the real service-account
key and the real `SCHEDULER_DATABASE_URL`, so `POST/DELETE /api/exits` edits the
live Google Sheet and the DB-backed PUTs hit Supabase. Keep browser verification
**read-only** unless the owner explicitly asks for a write test.

## 2. Chrome, signed in, without a password

Chrome ≥136 (we're on 150) **refuses `--remote-debugging-port` on the live
profile directory**, so it cannot be driven directly. Copy the owner's profile
into an isolated data dir once — cookies decrypt fine because it's the same macOS
user (same "Chrome Safe Storage" keychain item), so the Google/Clerk session
comes along and no credentials are ever needed.

Find the right profile **at runtime** — the directory names are not stable and
the mapping is the owner's private browser data, so derive it and don't record
it here. Pick the profile whose account is the one the app allowlists
(elyashivlavi@gmail.com):

```bash
CHROME_DIR="$HOME/Library/Application Support/Google/Chrome"
PROFILE=$(node -e "const fs=require('fs');
const j=JSON.parse(fs.readFileSync(process.argv[1]+'/Local State','utf8'));
const hit=Object.entries(j.profile.info_cache).find(([,v])=>v.user_name===process.argv[2]);
if(!hit) throw new Error('profile not found'); console.log(hit[0])" "$CHROME_DIR" elyashivlavi@gmail.com)
```

```bash
pkill -f "claude-chrome/shavtzak"; sleep 3          # kill only OUR instance
mkdir -p ~/.claude-chrome/shavtzak/Default
rsync -a --delete --exclude 'Cache' --exclude 'Code Cache' --exclude 'GPUCache' \
  --exclude 'DawnGraphiteCache' --exclude 'DawnWebGPUCache' --exclude 'Service Worker' \
  --exclude 'blob_storage' --exclude 'Extensions' --exclude 'IndexedDB' --exclude 'File System' \
  --exclude 'AutofillAiModelCache' --exclude 'optimization_guide*' \
  "$CHROME_DIR/$PROFILE/" ~/.claude-chrome/shavtzak/Default/   # ~1.4G → ~230M, a few seconds

nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$HOME/.claude-chrome/shavtzak" --remote-debugging-port=9222 \
  --no-first-run --no-default-browser-check --new-window "http://localhost:5173/?tab=personal" &
sleep 8; curl -s http://localhost:9222/json/version | head -2
```

Notes:
- The isolated instance runs **alongside** the owner's Chrome; it never touches
  his live profile (rsync reads only).
- `?tab=personal` (or `?tab=draft`, …) deep-links straight to the tab — cheaper
  than clicking through, and it exercises the real deep-link path.
- The copy is a **snapshot**: if the session has expired, re-run the rsync
  (`--delete` refreshes it in place). Only if that still lands on Clerk's
  sign-in page, ask the owner to finish "Continue with Google" in the window
  himself — never type his password.
- The copy holds real cookies. It lives outside the repo
  (`~/.claude-chrome/shavtzak`) and must stay out of git and out of any notes.

## 3. Drive it over CDP

Playwright lives in the **repo's** node_modules — import by absolute path when
the script sits in the scratchpad:

```ts
import { chromium } from '/Users/elyashiv/dev/ShmouelAttali/shavtzak/node_modules/playwright/index.mjs';
const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const p = ctx.pages().find(pg => pg.url().includes('localhost:5173')) ?? ctx.pages()[0];
await p.bringToFront();
```

`browser.close()` on a CDP connection only detaches — the window stays open for
the owner, which is what we want.

**Always prove which account is driving** (a wrong account silently changes which
tabs exist and which soldier is "me"):

```ts
await p.evaluate(() => document.querySelector('.cl-userButtonTrigger img')?.getAttribute('alt'));
// → "Elyashiv Lavi's logo"
await p.locator('nav button.border-blue-600').innerText();   // the active tab
```

## 4. Gotchas that cost time

- **`<label>` is a SIBLING of its control**, not a parent, in these components.
  `label:has-text("מחלקה") select` matches nothing — anchor on the wrapper:
  `div:has(> label:text-is("מחלקה")) > select`. `text-is` beats `has-text`
  because "מחלקה" also appears in the soldier info card and inside option text.
- **Assert on the DOM, not only on a picture**: dump
  `{value, selected, options}` from a `<select>` via `evaluate` — a screenshot
  can't tell a `<select>` from a `<datalist>` input, or prove the default option.
- Hebrew/RTL: locate by text, never by position. Keep exact spelling incl. quotes
  (`מפל"ג`, `חמ"ל`).
- Screenshot to `…/scratchpad/*.png` and `Read` it — that's the only way to
  actually *see* layout, and it catches things assertions miss.
- The sheet-backed tabs need no DB; the 🔒 scheduler tabs need
  `SCHEDULER_DATABASE_URL` reachable (that half is frozen — see the
  `postgres-scheduler` skill).

## 5. Report and leave it running

Tell the owner what was asserted (values, counts, before/after), attach the
screenshot, and say the window + servers are still up with the exact command to
stop them:

```bash
kill $(lsof -ti:3001) $(lsof -ti:5173); pkill -f "claude-chrome/shavtzak"
```

Never `pkill -f vite` / `pkill -f chrome` — that would take down the owner's own
processes.
