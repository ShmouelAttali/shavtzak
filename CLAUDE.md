# shavtzak — project guide

React + Vite + TS viewer app (RTL Hebrew) over the company **Google Sheet**,
deployed on Vercel at shavtzak-gaash.site. Serverless endpoints under `api/`
read the sheet through a Google service account.

**Active surface = the Google-Sheet-based app.** The repo also holds a
Postgres-backed scheduler (`scheduler/` + the seven 🔒 admin tabs), **frozen by
owner decision 2026-07-30** — no new work there, and its docs (`SPEC.md` /
`LOGIC.he.md`) are not to be updated for sheet-side changes. If a task really
touches the generator, the scheduler DB, or one of those tabs, load the
**`postgres-scheduler` skill**.

## Working style (owner request)

- **Subagents for large independent tasks only** — a fresh agent re-pays setup
  (reading CLAUDE.md, rediscovering files), so small edits, quick lookups and
  sequentially-dependent work stay inline. No recursive fan-out by default.
- Ask the owner questions **in English** (labels may quote Hebrew terms).
- Keep this file short. When something looks significant enough to record here,
  **ask the owner** before adding it.
- **After every fix, ask whether he wants it verified in the browser.** If yes,
  follow the **`browser-verify` skill** — dev servers + a real Chrome window
  signed in as elyashivlavi@gmail.com, driven over CDP. Keep its gotchas up to
  date there, not here.

## The Google Sheet is the source of truth

One spreadsheet (`GOOGLE_SHEET_ID`, default
`1FCuaQsOvDzrHcVhlYy49Mr5p6gTyTjEF1GqnW5frXDg`), three tabs, three handlers:

| Sheet tab | Endpoint | Shape |
|---|---|---|
| `מצבת החיילים` | `GET /api/soldiers` | roster + the presence matrix: soldier rows × date columns (`DD/MM/YY`), cell = status (נוכח / חופש / שחרור / לא מגיע / יציאה בערב …) |
| `כל השבצק` | `GET /api/shavtzak` | the real shifts, LONG format — one row per soldier-slot: תאריך / העמדה / סוג / השעה / החייל (`DD/MM/YYYY`) |
| `יציאות לזמן קצר` | `GET/POST/DELETE /api/exits` | short exits; POST appends a row, DELETE removes row N (`rowIndex` from the GET) |

Parsing gotchas (all three parsers are hand-rolled, in the handlers):

- **Headers are auto-detected, not fixed.** `/api/soldiers` scans the first 5
  rows for a `DD/MM/YY` cell to find the date row, matches info columns by
  Hebrew label (`מספר אישי`, `שם פרטי`, `תפקיד`, `מחלקה`, `מייל`…) with
  positional fallbacks, and treats a row as a soldier only if its מספר אישי is
  numeric. `/api/shavtzak` finds its header row by the exact labels above.
- **Hebrew labels and values are data keys** — keep the exact spelling,
  including quotes (`מ"מ`, `מפל"ג`). A typo silently drops rows or breaks a
  color/role lookup.
- **A blank תאריך means "same date as the row above"** in `כל השבצק`; the
  parser carries `currentDate` forward.
- Rows are grouped date → סוג (station group) → העמדה (sub-type) → השעה →
  soldiers, and `יומי` sorts last.

## Sheet dates are LITERAL

The sheet's own תאריך is always the correct calendar day for every row
(confirmed by the owner). There is **no 14:00-anchored schedule day and no
`h < 6 → h + 24` rollover** on this data — an early-morning slot is simply
earlier in the same day and sorts first. That mistake has been made twice; both
are pinned by tests (`tests/shavtzak-display.test.ts`,
`tests/personal-schedule.test.ts`). The 14:00→14:00 anchor belongs to the frozen
DB scheduler **and to the sheet's own Apps Script** (`apps-script/`, which does
reason in an operational day) — never import it into a viewer surface.

## The sheet also runs Apps Script (`apps-script/`)

The company sheet has a bound Apps Script project (`פלוגת געש`) that validates
and fills שבצק rows — code Google stores *only in the spreadsheet*. It is
mirrored into `apps-script/plugat-gaash/` with `clasp` (owner already logged in;
`.clasp.json` holds the script ID, and it is **not** the service account).

It is **HEAD-live**: no web app, no library, no versions — a push, like any save
in the script editor, is instantly live for every user of the sheet. Sync with
`npm run gs:status` / `gs:pull` / `gs:push`; pull before editing, and treat a
push as a deploy. ⚠ These scripts reason in a 14:00→14:00 operational day, which
the viewer deliberately does not — see above. Everything else lives in the
**`sheet-apps-script` skill**.

## Tabs and who sees them

`src/App.tsx` holds the tab table; sheet-based tabs are open to everyone:

- **לוז אישי** (`PersonalSchedule`) — one soldier's presence + missions.
  מחלקה defaults to **כלל הפלוגה** (`ALL_UNITS`), which lists the whole company;
  picking a real מחלקה narrows it. Choice persists in `localStorage`.
- **לוז יציאות מחלקתי** (`UnitSchedule`) — one מחלקה's presence grid.
- **סיכום פלוגתי** (`CompanySummary`) — 🔒 command roles, plus short exits.
- **שבצק** (`Shavtzak`) — the live schedule from `כל השבצק`. The biggest
  component; its name-rendering/popup contexts and layout renderers are reused
  by the draft tab.

Access has three layers, all in `App.tsx` + `useIsShavtzakAdmin`:

1. **Clerk** sign-in (`VITE_CLERK_PUBLISHABLE_KEY`) — no session, no app.
2. **The sheet's mail column = the allowlist** (`allowedEmails`): a signed-in
   address that is not in the roster gets אין גישה. An empty column allows
   everyone (fresh-sheet escape hatch).
3. **Per-tab restriction**: `'company'` = a command role in the sheet
   (`מ"פ/סמ"פ/מ"מ/סמל/מ"כ`) OR a `shavtzak_admins` row; `'scheduler'` =
   `shavtzak_admins` only; `'hamal'` = `shavtzak_admins` or a חמל-role soldier
   matched by email. Restricted tabs render a 🔒 and a deep link waits for the
   access lookup instead of bouncing.

The API itself is **not** authenticated server-side (known gap).

## Local dev

```bash
npm run dev:api   # tsx watch scripts/dev-api.ts — port 3001
npm run dev       # vite 5173, proxies /api → 3001
npm run build     # tsc && vite build (what Vercel runs)
npm test          # node:test + tsx over tests/*.test.ts
```

Env in `.env` / `.env.local` (git-ignored): `GOOGLE_SERVICE_ACCOUNT_KEY`
(base64 JSON — the sheet must be shared with that service account),
`GOOGLE_SHEET_ID`, `VITE_CLERK_PUBLISHABLE_KEY`. Deploy checks: the
**`vercel-deploy-monitor` skill**.

## Testing

The existing convention, worth matching: **logic worth a test lives in a pure
exported helper** (`src/lib/*.ts`, or a named export from the component) and
gets a `tests/*.test.ts` file — that is how the sheet parsers, date/sort math
and filter logic are covered. Purely presentational tweaks ship untested; don't
back-fill tests for code that has none.
