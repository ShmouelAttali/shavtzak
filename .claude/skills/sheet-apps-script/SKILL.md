---
name: sheet-apps-script
description: The Google Apps Script bound to the company sheet (ולידציה / מילוי כרמל / המלצות שבצ״ק) — mirrored into apps-script/ with clasp. Covers the HEAD-live release model (a push is a deploy), the sync.sh pull/push workflow, how to inspect script IDs, deployments, versions and triggers, and the 14:00 operational-day trap. Use for any task touching the sheet's own scripts, its menus/triggers, or "why did the sheet do X on its own".
---

# The sheet's Apps Script

The company sheet does not just hold data — it runs code. `onOpen` menus
validate the שבצק, fill כרמל rows and compute recommendations, writing back into
the same tabs `/api/soldiers` and `/api/shavtzak` then read. Google stores that
code **only inside the spreadsheet**; `apps-script/` is a `clasp` mirror of it.

## The one thing to internalize: it is HEAD-live

Apps Script only has a release cycle for **web apps, libraries, API executables
and add-ons**. This project is none of those, so every entry point runs HEAD —
the latest saved code.

Verified 2026-08-09 on `1S3MfB5AYSFX4RCwYQV-ykdB2XcxuAsQuJ1P3wOyPxzrnJu4VLX1sZyFn`:

| Check | Result |
|---|---|
| `grep doGet\|doPost` | 0 — not a web app |
| `appsscript.json` → `dependencies` | `{}` — no libraries |
| `clasp list-versions` | *No deployed versions of script* |
| `clasp list-deployments` | 1, the implicit `@HEAD` |

**So `clasp push` is a deploy.** It goes live for every user of the sheet the
moment it lands — no staging, no rollback but git and the IDE's project history.
Open tabs keep the old `onOpen` menu until they reload; installed triggers pick
up new code on their next fire.

Safe way to try something: `Make a copy` of the spreadsheet (the bound script
travels with the copy) and push to the copy's script ID.

## Sync workflow

```bash
npm run gs:status   # read-only: does Google differ from the repo?
npm run gs:pull     # Google -> repo, for edits someone made in the browser
npm run gs:push     # repo -> Google  ⚠ live immediately; asks you to type 'push'
```

`apps-script/sync.sh` wraps clasp with the guard that matters. The real failure
mode is someone editing in the script editor while you hold a stale mirror: you
push, their work is gone, and there is no version to restore it from.

So each successful pull/push writes a fingerprint of Google's content to
`apps-script/.sync-state`, and **push refuses when Google has moved since that
point**. Note what is *not* drift: your own local commits. An early version of
this guard compared the remote against `HEAD:apps-script/plugat-gaash`, which
blocked every legitimate edit→commit→push — the question is only ever "did
Google change since we last looked", never "does git differ from Google".

`.sync-state` lives outside `plugat-gaash/` on purpose: any `.json` inside the
project directory gets pushed to Apps Script as a source file.

Always `gs:status` before editing. Treat the browser copy as authoritative until
proven otherwise.

## What is in the project

`apps-script/plugat-gaash/` — project `פלוגת געש`, **owned by Shmouel Attali**
and shared with elyashivlavi@gmail.com, bound to spreadsheet
`1FCuaQsOvDzrHcVhlYy49Mr5p6gTyTjEF1GqnW5frXDg`.

- `ShabtzakOps.js` (~1.8k lines) — header `v3.10 שעון לחימה 14:00-14:00`.
  Validation (rest between shifts, overlaps, כרמל based on defense posts, כרמל
  minimum staff, tracker based on tours, daily hours, availability), the כרמל
  fills, and the roster-status diff dialog.
- `ShavtzakRecommendation.js` (~2.4k lines) — the recommendations engine, plus
  `installShabtzakTriggers` / `removeShabtzakTriggers`.
- `appsscript.json` — `Asia/Jerusalem`, V8, and a sheet macro `runShabtzakNow`
  on `Ctrl+Alt+Shift+1`.

Entry points, all HEAD: menu `פעולות שבצ״ק` (ולידציה לטאב שבצק / ולידציה לטאב כל
השבצק / מלא כרמל חטיבה / מלא כרמל גשש / צפה בשינויים), menu `שבצ״ק` (עדכן
המלצות / נקה המלצות / התקן ריצה אוטומטית / הסר ריצה אוטומטית), the macro, and an
**optional installable `onEdit`** (`onShabtzakEdit`) that a user installs from
the menu.

⚠ **The Triggers page lies by omission.** It lists only triggers owned by the
signed-in account. Shmouel can have `onShabtzakEdit` installed under his account
and yours will show 0. If the sheet "changes by itself", that is the first thing
to suspect, and you cannot confirm it from your own account.

## ⚠ The 14:00 trap — the two halves disagree

`CLAUDE.md` says **sheet dates are LITERAL** for the viewer: the תאריך in a row
is that row's calendar day, no 14:00 anchor, no `h < 6 → h + 24`. That is
owner-confirmed and pinned by `tests/shavtzak-display.test.ts` and
`tests/personal-schedule.test.ts`.

The Apps Script does the opposite. `CONFIG.OPERATIONAL_DAY_START_HOUR = 14`, and
its header states *"שעות לפני 14:00 שייכות קלנדרית ליום שאחרי התאריך הרשום"* —
hours before 14:00 belong to the day *after* the written date. See
`operationalDayOfDateTime_`, `calendarDateForOpDaySlot_`,
`normalizeToOperationalDay_`, `getPreviousOpDayShifts_`.

Both statements are load-bearing where they live. **Never carry one convention
into the other half**, and never "fix" the viewer to match the script (that
mistake has already been made twice). Flagged to the owner 2026-08-09; if he has
since reconciled them, this section is what needs updating.

## Inspecting Google's side

clasp is installed globally (3.3.0) and already logged in as
elyashivlavi@gmail.com via `~/.clasprc.json`. That is a **user** OAuth login —
the `GOOGLE_SERVICE_ACCOUNT_KEY` used by the API handlers cannot read or write
script source at all.

```bash
clasp show-authorized-user
clasp list-versions <scriptId>      # empty output = HEAD-only project
clasp list-deployments <scriptId>   # "@HEAD" alone = no published web app
clasp open-script                   # from apps-script/plugat-gaash
```

Gotchas that cost time:

- **`clasp list` returns "No script files found"** — it lists Drive-owned
  scripts, and this project belongs to Shmouel. Not an auth problem. Get script
  IDs from the IDE instead.
- **macOS has no `timeout`** — don't prefix clasp calls with it.
- `clasp clone` wants an empty directory and writes its own `.clasp.json`; use a
  temp dir when you just want to read the remote.
- `.clasp.json` is committed on purpose (script ID only, no secret).

To find a script ID without clasp, drive the owner's Chrome (see the
**`browser-verify` skill** for the profile-copy + raw-CDP setup — Playwright's
`connectOverCDP` does not work against this Chrome):

1. `https://script.google.com/home/all` lists the projects; each row links to its
   **container** spreadsheet, which is how you tell which one is bound to the app's sheet.
2. Clicking the project name navigates to
   `/home/projects/<scriptId>/edit` — read the ID out of `location.href`.
3. `/home/projects/<scriptId>/triggers` shows this account's triggers.

Guard page evaluations with `(document.body && document.body.innerText) || ''` —
during navigation `document.body` is briefly `null` and the eval throws.

## Out of scope

`שבצ״ק מוצב` (script `1owVVlnVjsAbMiqmCmm6VYCM7hNIvQVUXNmadVEYJ9uAaovRMc5jw6B59`,
container `1UTv1ROFinupRG0Kc_p7guui0RTBS238md_MXrprY2LY`) is a *different*
project on a *different* spreadsheet: a real web app (`doGet` + `Index.html`,
74 versions, 4 deployments, `executeAs: USER_DEPLOYING`,
`access: ANYONE_ANONYMOUS` — publicly reachable without sign-in). Owner decision
2026-08-09: **not mirrored, out of scope.** Do not clone it into the repo, and
do not confuse its versioned release cycle with the HEAD-live one above.
