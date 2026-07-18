---
name: deployment-requests-sheet
description: Access and parse the "Soldier Deployment Records" Google Sheet (per-soldier scheduling requests/constraints submitted via form, Hebrew free-text). Covers the two access paths — service account via Sheets API (needs the doc shared with the SA) and the Chrome same-origin fetch fallback that always works — plus the tab's column semantics and parsing gotchas. Use when asked to read soldier requests/constraints for a date or week, or any task naming this sheet / spreadsheet id 161wIvLFIsBhQNLjm3bMrBGH2qTgVE0mwyu7QaS6fPy0.
---

# Soldier Deployment Records sheet (per-soldier requests)

## What it is

- Spreadsheet id: `161wIvLFIsBhQNLjm3bMrBGH2qTgVE0mwyu7QaS6fPy0`
- URL: https://docs.google.com/spreadsheets/d/161wIvLFIsBhQNLjm3bMrBGH2qTgVE0mwyu7QaS6fPy0/edit?gid=1252863416
- Single tab: **"Soldier Deployment Records"** (gid `1252863416`).
- This is a **different document** from the company sheet the viewer app reads
  (`GOOGLE_SHEET_ID` = `1FCuaQsOvDzrHcVhlYy49Mr5p6gTyTjEF1GqnW5frXDg`). Do not
  assume the project's service account can see it (see Access below).
- Content: form-submitted per-soldier scheduling requests/constraints
  (half-day exits, "don't schedule me at hour X", swap-week presence notes,
  medical appointments) — one row per soldier+date.

## Columns

| Col | Header | Meaning |
|-----|--------|---------|
| A | `Soldier Name` | Hebrew full name, matches roster spelling |
| B | `Deployment Date` | The date the request applies to, ISO `YYYY-MM-DD` (all rows so far) |
| C | `Deployment Details` | Hebrew free text, always prefixed `[הוגש: D.M.YYYY, H:MM:SS]` = form submission timestamp; the actual request follows. May contain newlines. |
| D | (no header) | Sparse handling marker — blank or `VVV` (appears on a few rows; meaning: handled/acknowledged, not confirmed with owner) |

Parsing gotchas:

- Column C is a request in free text, NOT structured times: times appear as
  `17:30-23:00`, `20.30 עד 22.30`, `0815-1300`, `ב20.00`, or pure prose.
  Extract from/to times heuristically; keep the verbatim text.
- Multi-day requests are duplicated: the same submission timestamp appears on
  several rows, one per affected date (e.g. swap-week pairs אחיה עסיס ↔ אליהו
  אדרי each have rows on both 19/07 and 22/07). Dedupe by the `[הוגש: ...]`
  timestamp when aggregating per soldier.
- Rows are mostly date-sorted but NOT strictly — late submissions are appended
  at the bottom (e.g. rows for 20-25/07 after rows for September). Always scan
  the whole tab, never stop at the first out-of-window date.
- Not every row is an exit: many are "keep me free between X-Y" or presence
  ("אני נוכח") notes. Classify before treating as unavailability.

## Access

### Path 1 — Sheets API with the project service account (preferred once shared)

The repo's service account is `shavtzak@shavtzak-1984.iam.gserviceaccount.com`
(base64 JSON in `GOOGLE_SERVICE_ACCOUNT_KEY` in the repo root `.env`). The doc
**was shared with it (Viewer) on 2026-07-18** and this path is verified
working. If it ever 403s again (`PERMISSION_DENIED`), the sharing was revoked
— a service account only sees docs explicitly shared with its email; re-add it
via Share on the sheet (the `GOOGLE_SHEETS_API_KEY` path is no substitute: API
keys only work on link-public sheets). Working pattern:

```js
// node script, repo root as cwd (or import by absolute node_modules path)
import { GoogleAuth } from '/Users/elyashiv/dev/ShmouelAttali/shavtzak/node_modules/google-auth-library/build/src/index.js';
const b64 = /GOOGLE_SERVICE_ACCOUNT_KEY=(\S+)/.exec(fs.readFileSync('<repo>/.env','utf8'))[1];
const auth = new GoogleAuth({ credentials: JSON.parse(Buffer.from(b64,'base64').toString()), scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const token = (await (await auth.getClient()).getAccessToken()).token;
// values:
fetch(`https://sheets.googleapis.com/v4/spreadsheets/161wIvLFIsBhQNLjm3bMrBGH2qTgVE0mwyu7QaS6fPy0/values/${encodeURIComponent("'Soldier Deployment Records'!A1:D2000")}`, { headers: { Authorization: `Bearer ${token}` } })
```

(ESM note: a script living outside the repo can't bare-import
`google-auth-library`; import via the absolute `node_modules/.../build/src/index.js`
path as above.)

### Path 2 — Chrome same-origin fetch (fallback, no sharing needed)

Elyashiv's logged-in Chrome has access. Drive it via AppleScript (no setup —
see the chrome-browser-control memory). Recipe that worked end-to-end:

```bash
# 1. open the doc in a background tab and let it load
osascript -e 'tell application "Google Chrome" to make new tab at end of tabs of front window with properties {URL:"https://docs.google.com/spreadsheets/d/161wIvLFIsBhQNLjm3bMrBGH2qTgVE0mwyu7QaS6fPy0/edit?gid=1252863416"}'
sleep 6
# 2. same-origin fetch of the CSV export inside the tab (async: start, then poll)
osascript -e 'tell application "Google Chrome" to execute tab (count of tabs of front window) of front window javascript "window.__csv=null; fetch(\"/spreadsheets/d/161wIvLFIsBhQNLjm3bMrBGH2qTgVE0mwyu7QaS6fPy0/export?format=csv&gid=1252863416\").then(r=>r.text()).then(t=>window.__csv=t); 0"'
sleep 4
# 3. pull it out base64 (survives Hebrew + newlines through osascript)
osascript -e 'tell application "Google Chrome" to execute tab (count of tabs of front window) of front window javascript "btoa(unescape(encodeURIComponent(window.__csv)))"' \
  | tr -d '\n' | base64 -D -o /tmp/deploy.csv   # macOS base64: -D -o, not -d
# 4. close the tab you opened
osascript -e 'tell application "Google Chrome" to close tab (count of tabs of front window) of front window'
```

Notes: `execute ... javascript` returns synchronously — a fetch must stash its
result on `window` and be polled. Requires Chrome's "Allow JavaScript from
Apple Events" (already enabled on this Mac). The unauthenticated
`export?format=csv` curl returns 401 — the doc is not link-public.

### Path 3 — unauthenticated curl / API key

Both fail today (401 / 403). Only becomes viable if the owner makes the doc
"anyone with the link can view".

## Filtering by date window

Column B is ISO so plain string comparison works, but normalize defensively
(`19/7`, `19.7.2026` may appear later):

```python
m = re.match(r'^(\d{4})-(\d{1,2})-(\d{1,2})$', b) or re.match(r'^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$', b)  # 2nd form is D/M(/Y), default year = current
```

Remember the scheduler's day runs 14:00→14:00 — a request "for 19/07" in this
sheet means the calendar date; map to schedule days explicitly when feeding
the generator.
