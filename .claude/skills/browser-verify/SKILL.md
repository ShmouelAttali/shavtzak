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

## 3. Drive it over CDP — raw, NOT Playwright

⚠ **`chromium.connectOverCDP()` does not work here.** Playwright 1.61 against
Chrome 150 dies immediately on handshake:

```
browserType.connectOverCDP: Protocol error (Browser.setDownloadBehavior):
Browser context management is not supported.
```

Don't spend time on it — Node 26 ships a **global `WebSocket`**, so speak CDP
directly. ~40 lines, no dependency, and it exposes `Page.printToPDF` and
`Emulation.*` that Playwright would have wrapped anyway. Keep a `cdp.mts` in the
scratchpad:

```ts
const list = await (await fetch('http://localhost:9222/json/list')).json();
const target = list.find((t: any) => t.type === 'page' && t.url.includes('localhost:5173'));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('ws')); });
// then: id-matched {id, method, params} sends, resolve on the matching msg.id;
// Runtime.enable + Page.enable once, and evaluate via
//   Runtime.evaluate {expression: `(${fn})()`, returnByValue: true, awaitPromise: true}
// — always check result.exceptionDetails, a thrown eval otherwise looks like undefined.
```

**If `/json/list` returns `count 0`** (it happens to a long-lived instance — the
window got closed but the process lives, while `/json/version` still answers),
don't restart Chrome and re-rsync. Just make a page:

```bash
curl -s -X PUT "http://localhost:9222/json/new?http://localhost:5173/?tab=shavtzak"
```

**Poll for content, never `sleep(n)`.** `/api/shavtzak` reads the live sheet and
takes **~25–30 s cold**; a fixed 6 s sleep just screenshots "טוען שבצק..." and
every later assertion then reports absent/0 and looks like a real bug. Poll on a
DOM fact (`main .rounded-xl.border-2` count > 0) with a ~60 s ceiling.

**Force a desktop viewport** before measuring or screenshotting, or Tailwind's
`sm:` breakpoint collapses every 2-column grid and the layout you judge is the
phone one:

```ts
await send('Emulation.setDeviceMetricsOverride', {width: 1400, height: 1000, deviceScaleFactor: 2, mobile: false});
// ...and clear it when done: Emulation.clearDeviceMetricsOverride
```

**Always prove which account is driving** (a wrong account silently changes which
tabs exist and which soldier is "me"):

```ts
document.querySelector('.cl-userButtonTrigger img')?.getAttribute('alt')  // → "Elyashiv Lavi's logo"
document.querySelector('nav button.border-blue-600')?.textContent          // the active tab
```

## 3b. Verifying print / PDF output

The שבצק tab's **הדפס** button is `window.print()` over a print stylesheet
(`@media print` in `src/index.css` + `print:` classes). To see what paper gets:

```ts
await send('Emulation.setEmulatedMedia', {media: 'print'});   // print CSS, live DOM — assert computed styles here
const pdf = await send('Page.printToPDF', {
  printBackground: true,       // else every colored group header comes out white
  preferCSSPageSize: true,     // honours @page { size: A4 landscape }
  displayHeaderFooter: false,
});
await send('Emulation.setEmulatedMedia', {});                 // ALWAYS restore, or the owner's window stays in print mode
```

Assert on computed style under print media, not just the picture: `display` of
`header` / `div.sticky.top-0` (must be `none`), `breakInside`, `overflowX`,
`printColorAdjust` (`exact`).

Confirm the paper size from the PDF itself rather than trusting the CSS —
`/MediaBox [0 0 841.92 594.96]` × 25.4/72 = **297 × 210 mm = A4 landscape**.
Page count: `len(re.findall(rb'/Type\s*/Page[^s]', pdf))`.

**Measure clipping numerically — a screenshot hides it.** Set the viewport to the
true printable width (A4 8mm margins: **portrait 733px, landscape 1062px**) under
print media, then compare each card's content against its box:

```ts
const need = Math.max(...[...card.querySelectorAll('table, .grid')].map(t => t.scrollWidth));
const have = card.getBoundingClientRect().width;   // need > have → that many px are cut off
```

Names are `whitespace-nowrap`, so overflow truncates a name rather than wrapping
it — by eye that reads as a font artifact, not as missing data. Only the numbers
tell you.

⚠ **A wrapper `<table>` used for the repeating header defaults to
`table-layout: auto`, which sizes to its content's *min-content* width, not the
page.** Symptom: the table measures wider than the viewport and sits at a
negative `x` (RTL), so the page header looks truncated ("57 ח") while the cards
themselves seem fine. Fix is `table-layout: fixed; width: 100%`. Until you do
this, overflow measurements are meaningless — content spills off-page instead of
overflowing its card, so the check above reports clean.

**Rasterizing the PDF to actually look at it:** this box has **no `pdftoppm`, no
ghostscript, no imagemagick, and no pyobjc `Quartz`**; `sips -s format png` works
but only ever converts **page 1**. Use Chrome's own PDFium: navigate the driven
page to `file:///…/x.pdf#page=N&zoom=page-fit` and screenshot per page.
Caveat — the `#page=N` fragment is **imprecise** (asking for 2 landed on 4), so
read the page number off the viewer's own toolbar in the screenshot instead of
trusting N.

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
