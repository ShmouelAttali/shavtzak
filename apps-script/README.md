# apps-script — the sheet's own Google Apps Script, mirrored into git

Google keeps this code **only inside the spreadsheet**. This directory is a
`clasp` mirror so it has real history, review and diffs. It is a mirror, not the
source of truth — Google's copy wins until you `clasp push`.

## `plugat-gaash/` — bound to the company sheet

| | |
|---|---|
| Project | `פלוגת געש` (owner: Shmouel Attali, shared with elyashivlavi@gmail.com) |
| Script ID | `1S3MfB5AYSFX4RCwYQV-ykdB2XcxuAsQuJ1P3wOyPxzrnJu4VLX1sZyFn` |
| Container | spreadsheet `1FCuaQsOvDzrHcVhlYy49Mr5p6gTyTjEF1GqnW5frXDg` — the same sheet `/api/soldiers`, `/api/shavtzak` and `/api/exits` read |
| Files | `ShabtzakOps.js` (~1.8k lines, validation + fills + roster diff), `ShavtzakRecommendation.js` (~2.4k lines, recommendations engine), `appsscript.json` |

**Entry points** — all of them run HEAD:

- `onOpen` builds two menus: `פעולות שבצ״ק` (ולידציה לטאב שבצק / ולידציה לטאב
  כל השבצק / מלא כרמל חטיבה / מלא כרמל גשש / צפה בשינויים) and `שבצ״ק`
  (עדכן המלצות / נקה המלצות / התקן ריצה אוטומטית / הסר ריצה אוטומטית).
- a sheet macro `runShabtzakNow`, bound to `Ctrl+Alt+Shift+1`.
- an **optional installable `onEdit`** (`onShabtzakEdit`), installed per-user
  from the menu. It is not in code-as-config — whoever clicks "התקן ריצה
  אוטומטית" owns a trigger under their own account.

**No release cycle.** Verified 2026-08-09: no `doGet`/`doPost`, `dependencies`
is empty (no libraries), `clasp list-versions` → *no versions*, and the single
deployment is the implicit `@HEAD`. So **a save in the script editor — or a
`clasp push` from here — is live for every user of the sheet immediately**
(menus refresh on the next reload; installed triggers use the new code on their
next fire). There is no staging and no rollback other than the IDE's project
history or this git directory.

## Data validation on `מצבת החיילים` (already applied)

Approved exits are typed into the presence cells in one of three forms, all in
whole hours (0–23) within one calendar day:

| Written in the cell | Means |
|---|---|
| `יציאה מ10 עד 22` | away 10:00 → 22:00 |
| `יציאה מ20` | leaves at 20:00 and does not return before midnight |
| `יציאה עד 10` | not on base from midnight until 10:00 |

**A cell can carry only one validation rule, and a custom formula never renders a
dropdown.** Making the format strictly enforceable would therefore have cost the
officer his dropdown on every one of ~11.6k cells, where נוכח/חופש are the
overwhelming majority of entries. Owner decision 2026-08-09: keep the dropdown.

So the rule on **`O4:CR145`** (the exact footprint, mapped rather than guessed —
it stops at row 145, and the list range is `C2:C30`, not `C2:C12`) is unchanged
except that `strict` went from *reject input* to *show warning*:

```jsonc
{
  "condition": { "type": "ONE_OF_RANGE",
                 "values": [{ "userEnteredValue": "='אפשרויות'!$C$2:$C$30" }] },
  "strict": false,          // show a warning instead of rejecting
  "showCustomUi": true,     // keep the dropdown
  "inputMessage": "…the three יציאה forms…"
}
```

Consequence: the sheet no longer polices the exit format — a typo is kept with an
orange corner. **The scripts are the real gate.** `parseExitStatus_` accepts only
the three forms, and any `יציאה` value with digits that fails to parse raises a
warning in ולידציה, so a malformed exit surfaces rather than silently reading as
"present". That warning text is the officer's source of truth for the format.

Applied via the Sheets API with the service account (which has write access —
the same one `/api/exits` uses). To re-apply or adjust, a `setDataValidation`
batchUpdate over `{sheetId: 1046410175, rows 3–145, cols 14–96}` is all it takes.

**The 14:00→14:00 operational day is a grouping, not a date convention.** תאריך
is always the row's literal calendar day — within one operational day the sheet
writes 22:00 under `11/08` and 06:00 under `12/08`. `operationalDayOfDateTime_`
groups those into one day; `normalizeToOperationalDay_` shifts pre-14:00 times by
24h only on the internal minute axis so shifts can be compared within a day.

That does not contradict "Sheet dates are LITERAL" in `CLAUDE.md` — which forbids
a *viewer* surface from inventing a rollover, and remains pinned by
`tests/shavtzak-display.test.ts`. Don't give the viewer an operational day, and
don't conclude the two halves disagree; see the `sheet-apps-script` skill.

## Working with it

```bash
npm run gs:status   # read-only — does Google differ from this repo?
npm run gs:pull     # Google -> repo, for edits someone made in the browser
npm run gs:push     # repo -> Google  ⚠ LIVE IMMEDIATELY; asks you to type 'push'
```

All three are `apps-script/sync.sh`. The failure mode worth guarding is: someone
edits in the script editor, you push, their work is gone and there is no version
to restore. So every successful pull/push records a fingerprint of Google's
content in `apps-script/.sync-state`, and **push refuses to run if Google has
moved since then**. Your own local commits are not drift — they are just work
waiting to be pushed — so a normal edit→commit→push still works.

`.sync-state` sits outside `plugat-gaash/` deliberately: a `.json` inside the
project directory would be pushed to Apps Script as a source file.

Raw clasp still works from `apps-script/plugat-gaash` (`clasp open-script`,
`clasp list-versions`, `clasp list-deployments`).

Auth is a global `clasp login` (`~/.clasprc.json`, already set up for
elyashivlavi@gmail.com) — **not** the `GOOGLE_SERVICE_ACCOUNT_KEY` the API
handlers use; the service account cannot read or write script source.

`.clasp.json` is committed on purpose: it only holds the script ID, and without
it `pull`/`push` don't know the target.

Safe way to try a change: `Make a copy` of the spreadsheet (the bound script
travels with it) and push to the copy's script ID instead.

## Not mirrored here

`שבצ״ק מוצב` (script `1owVVlnVjsAbMiqmCmm6VYCM7hNIvQVUXNmadVEYJ9uAaovRMc5jw6B59`,
container `1UTv1ROFinupRG0Kc_p7guui0RTBS238md_MXrprY2LY`) is a **separate**
Apps Script *web app* on a **different** spreadsheet — `doGet` + `Index.html`,
74 versions, 4 deployments, `executeAs: USER_DEPLOYING`,
`access: ANYONE_ANONYMOUS`. That one does have a real versioned release cycle.
Unrelated to this repo's sheet; mirror it here only if the owner asks.
