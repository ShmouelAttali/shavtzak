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

- `ShabtzakOps.js` (~1.8k lines) — header `v3.11 שעון לחימה 14:00-14:00`.
  Validation (rest between shifts, overlaps, כרמל based on defense posts, כרמל
  minimum staff, tracker based on tours, daily hours, availability), the כרמל
  fills, and the roster-status diff dialog.

**Daily missions are written four ways** and all of them mean the same thing:
`יומי`, `14:00-14:00`, and the split-at-09:00 pair `14:00-09:00` (19h) +
`09:00-14:00` (5h). v3.11 classifies any range of `DAILY_MIN_SPAN_HOURS` (12) or
more as a daily mission — counted as `DAILY_HOURS` (8) toward the cap and
excluded from overlap checks, exactly like `יומי`. The short complement stays an
ordinary shift, by owner decision 2026-08-09.

Before v3.11 only the literal word `יומי` was handled, so the other spellings
were counted at 19–24h: **184 over-8h errors and 50 overlap errors across 13 days
of real data, of which 135 and 34 were false.** Pinned by
`tests/apps-script-daily-mission.test.ts`. If validation output ever looks like
noise again, check the time-spelling census first — that harness is the fastest
way to tell a format drift from a real scheduling problem.
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

## יציאה קצרה — approved short exits

An approved exit is written by the officer into the `מצבת החיילים` date cell in
one of **three whole-hour forms**, always within a single calendar day:

| Cell text | Window |
|---|---|
| `יציאה מ10 עד 22` | 10:00 → 22:00 |
| `יציאה מ20` | 20:00 → midnight ("won't return before the end of the day") |
| `יציאה עד 10` | midnight → 10:00 |

Hours are 0–23, one or two digits, no minutes — `יציאה 12:00-20:00` is **not** a
valid form (it was the first design and was replaced).

⚠ **`עד 0` / `עד 00` cannot mean midnight.** `parseExitStatus_` accepts the hour
(0 is in range) and then rejects the window on `end <= start`, so
`יציאה מ15 עד 00` parses to `null` — the officer's intent ("out from 15:00 to
midnight") is silently dropped and the soldier reads as fully available. Midnight
is spelled by *omitting* the end: `יציאה מ15`. One such cell was live on
12/08/2026 (משה רבינוביץ). `looksLikeTimedExit_` does flag it in ולידציה,
which is the only thing that catches it. Not fixed — the fix is a parser
decision the owner has to make, since `עד 0` is ambiguous with "until 00:xx".

⚠⚠ **NEVER rewrite the `מצבת החיילים` validation through the Sheets API.**
`O4:DG145` carries a `ONE_OF_RANGE` dropdown over `'אפשרויות'!$C$2:$C$30` whose
options are **coloured chips** (נוכח green, חופש purple, לא מגויס grey). The v4
API does not expose those colours — a read returns only `condition`, `strict`
and `showCustomUi` — so any `setDataValidation` write rebuilds the rule from
those three fields and **silently destroys the colouring across ~11.6k cells**.
This happened on 2026-08-09.

Things that do *not* work, both verified:
- `repeatCell` with `fields: "dataValidation.strict"` → 400 *"No conditionType
  specified"*. The API validates the whole rule even under a narrow field mask,
  so there is no way to touch `strict` alone.
- Reading the rule first and writing it back — the colours were never in the read.

What *does* work: **`copyPaste` with `pasteType: PASTE_DATA_VALIDATION`**. It
copies the rule server-side, colours included, and touches no values. That is how
the damage was undone — source `CS4`, which sat outside the overwritten block and
still held the original. Keep that trick in mind: any surviving cell with the
rule, or the `מצבת החיילים - גיבוי 2` tab, is a restore source.

**Anything that changes this rule must be done in the Sheets UI**
(נתונים → אימות נתונים → the rule → אפשרויות מתקדמות), which preserves the chips.
That is how the strict→warn switch was applied on 2026-08-09; the end state is
13,774 cells on one rule, chips on, `strict: false`.

Driving that dialog over CDP: the `אפשרויות מתקדמות` section is **collapsed by
default**, and while collapsed the `[role="radio"]` elements exist in the DOM but
report a zero-size rect, so coordinate clicks silently miss. Expand the section
first, then click; verify with `aria-checked` on the radios before pressing סיום.

Whichever way the rule ends up, `looksLikeTimedExit_` must keep warning on
unparseable `יציאה` values — under "show a warning" the sheet accepts typos, and
that warning is the only thing standing between a mistyped exit and a soldier
being scheduled while out. Requests originate in
the separate *Soldier Deployment Records* doc (see the
`deployment-requests-sheet` skill), but **approval is manual and neither script
reads that doc** — which is what lets `ShavtzakRecommendation.js` keep its
`/** @OnlyCurrentDoc */` annotation and its narrow OAuth scopes. The cell text is
the entire contract.

Semantics, decided by the owner 2026-08-09:

- It **occupies its window only** — not the whole day. Half-open, so an exit
  ending 22:00 and a shift starting 22:00 are both fine.
- It is **worth 0 working hours and requires no rest around it**. On the Ops side
  that is free (exits live in the roster, never in `כל השבצק`, so they can't
  enter hours or rest math). In the engine it is deliberate: the exit is *not*
  injected into `assignments`, only checked for overlap.
- Legacy dropdown values (`יציאה בערב`, `יציאה בבוקר`, `יציאה ב14:00`) have no
  times and keep behaving exactly as before — they block nothing.
- A value starting with `יציאה` that contains digits but fails to parse raises a
  **warning**, never silence. A swallowed exit shows the soldier as available,
  which is the exact failure this feature exists to prevent.

`parseExitStatus_` / `looksLikeTimedExit_` / `rangesOverlap_` live in
`ShabtzakOps.js` and are used from both files — the project shares one global
scope. ⚠ That scope also means **`addDays_`, `formatHours_` and `pad2_` are
defined in both files**; the engine's definitions win (files load in filename
order, `ShabtzakOps` first). The two `addDays_` differ — Ops strips the time,
the engine preserves it — so never rely on that behavior without checking.

In the engine the block sits in `evaluateCandidateForTask_` **outside**
`availabilityCache` on purpose: that cache is keyed per day, so caching a
time-dependent answer would leak one slot's verdict onto another.

`exitPackageMisfitPenalty: 45` is a *soft* penalty on a partial mission whose
complementary shift has nowhere to go around the exit. It is deliberately
conservative — it fires only when **no** contiguous gap in the operational day
fits the residual hours, so it under-fires rather than mis-steering. When the
exit fits several mission types, nothing is penalised and ordinary factors
(rotation, same-task-yesterday, load) decide, which is the required behavior.

## The summary block at the top of `שבצק` (J3:K5)

Three live counters sit above the task table — title in J, formula in K:

| | |
|---|---|
| `K3` חיילים זמינים | from `מצבת החיילים`, the E1 date column: not חופש / לא מגויס, **מחלקה 1/2/3 only** |
| `K4` חיילים במגן | distinct pool soldiers currently assigned to a `*מגן*` position on this tab |
| `K5` חיילים לסיור | `K3 − K4 − 12 סטטיות − 8 התקפי − 2 תורנים − חפק − קצין מוצב`, target 10–12 |

⚠ **Rows above the task table are capped by `config.tasks.headerSearchRows`.**
`resolveScheduleLayout_` scans that many rows for the header; anything below is
invisible and the engine fails to find its columns. The header now sits at row 6.

The repo is at **20**, but that only helps once it is deployed — **the live script
is still at 6**, i.e. exactly at the limit with today's 3 inserted rows. So until
someone runs `gs:push`, a 4th row breaks the recommendations. Check the live value,
not the repo's, before adding rows.

Row 1 (with `E1`) was deliberately left in place, which is what let the summary
block ship with no script change at all: `E1` is hardcoded in **8** places across
both files.

Measured facts behind the arithmetic (10/08 + 11/08, verified against real data):

- **כרמל and כונן גשש must NOT be subtracted.** Both are standby held *on top of*
  a real mission — 12 and 3 soldiers respectively, **0 exclusive** on both days.
  This matches the code giving them `hoursForDailyTotal = 0`.
- **חמל must NOT be subtracted either** — it is manned entirely by the `חמ"ל`
  platoon, which is outside the assignment pool (so it is also excluded from K3).
- סטטיות is 12 = 24 four-hour slots ÷ 2 shifts per soldier.
- With those rules the decomposition is exact: on 11/08,
  `45 pool-available − 10 מגן − 12 − 8 − 2 − 3 חפק − 1 קצין = 9 = actual סיור`.

### Google Sheets gotchas that cost real time here

- **`COUNTUNIQUE` does not propagate `FILTER`'s `#N/A`** when nothing matches — it
  counts the error as one distinct value and returns **1**, so
  `IFERROR(COUNTUNIQUE(FILTER(…)),0)` silently yields 1 instead of 0. Guard with a
  separate `SUMPRODUCT`/`COUNTIFS` count first. (`JOIN(FILTER(…))` *does* error, so
  use it to tell the two cases apart while debugging.)
- **`מחלקה` is stored as a number**, not text — `=("1")` comparisons are all false.
  Dates (`E1`, the roster date row) are serial numbers, so `MATCH` on them works.
- Avoid `{1;2;3}` array literals — the separators are locale-dependent. Use
  `(x=1)+(x=2)+(x=3)`.
- The tab is only **42 columns** wide; writing a probe formula beyond that
  silently returns nothing rather than erroring.
- Inserting rows rewrites relative same-sheet references (`K4`→`K7`) while leaving
  `$E$1` and cross-sheet refs alone — so a naive "shift every number" diff reports
  false damage. Compare computed values, or spot-check.

## ⚠ Hebrew keywords lie — check them against the sheet before trusting them

Both scripts classify rows by searching for Hebrew substrings in
`position + ' ' + type`. Two separate bugs have come from a keyword that simply
never matched, and **both failed in total silence** — the row just gets no
category, no group, no exemption, and nothing anywhere says so.

| code literal | real sheet value | matches? | cost |
|---|---|---|---|
| `'תורן'` — final nun `ן` | `תורנים` — regular nun `נ` | **no** | 108 rows in `כל השבצק` had no rotation group at all |
| `'מפלג'` | `מפל"ג` — with גרשיים | **no** | would have silently un-fixed the מפל"ג exemption |

Two traps, and they compose:

- **Final letters.** `ן ם ך ף ץ` are distinct characters from `נ ם כ פ צ`.
  `'תורן'` cannot match `תורנים`; only `'תורנ'` can. Any keyword whose last
  letter is a final form matches *only* the word in isolation.
- **The two files normalize differently.** `normalizeForSearch_` (engine) strips
  `" ' ״ ׳`; `normalize_` (Ops) strips only directionality marks and whitespace.
  So the same keyword list is safe in one file and broken in the other. When
  matching a unit or role on the Ops side, go through `normalizeUnitText_`.

The census is one API call and settles it — list every distinct
`position || type` in `כל השבצק` with counts before adding a keyword. That is
how the `תורנים` spelling was found, and how you'd notice a new one appearing.
Order matters too: `כונן גשש ותורן רס"פ` contains both `גשש` and `תורן`, and the
גשש check deliberately runs first.

## Verifying an engine change before you deploy it

A push is a live deploy, and the engine is ~2.5k lines of scoring where a
one-line change can reorder every candidate list. Two committed tools:

```bash
npx tsx apps-script/tools/offline-validate.mts --last 14   # validators, per op day + blame
npx tsx apps-script/tools/ab-recommendations.mts           # engine: HEAD vs working tree
```

`ab-recommendations.mts` runs both versions of the engine over the *same* live
snapshot in a fake `SpreadsheetApp` and prints only the cells that differ, so
"6 cells changed, all in the התקפי block" becomes a fact you can paste into the
commit message. `--base <ref>`, `--only <substring>`, `--full`.

⚠ **The sheet moves under you.** It is rebuilt for the next day constantly, and
a block you are testing may be empty by the time you run — which yields
`0 cells changed`, indistinguishable from "no regression" unless you look. The
tool prints coverage first and exits 2 on an empty comparison for exactly this
reason. If the block you need is empty, inject a lineup into the snapshot and
compare that instead of concluding anything from a vacuous run.

Both tools load **both** script files in filename order, because Apps Script
concatenates them into one global scope; a harness that loads only
`ShavtzakRecommendation.js` throws `ReferenceError` the moment the engine calls
something defined in `ShabtzakOps.js`.

**Read the A/B output, not just its cell count.** It catches design mistakes,
not only regressions. Making `כונן גשש` require a tour descent looked right in
the tests and shipped a rule where *every* candidate came out `בדוחק` — the 8h
tour plus the 8h shift always crossed `maxSameDayMissionHours`, so the marker
stopped meaning anything. Nothing but the real snapshot showed that. A green
suite plus "N cells changed" is not evidence the rule does what you meant.

### A rule that fires rarely: prove the branch, don't infer it

Most engine rules fire on a handful of rows, so "1 cell changed" is the normal
result and by itself says nothing. Two things turn it into evidence:

- **Count the eligible cases in the snapshot, not the changed cells.** For the
  v3.21 `משימה קודמת` change, a census of the roster's three date columns showed
  exactly **one** soldier returning from חופש inside them — and that soldier was
  the one cell that changed. 1 of 1 is an argument; 1 of unknown is not.
- **Inject into the snapshot to reach the branch that didn't fire.** The `כל
  השבצק` and `מצבת החיילים` grids are plain arrays in the tool; splice the
  anchor line and mutate one before the diff runs:

  ```ts
  for (const t of TABS) snapshot[t] = await fetchTab(t);
  snapshot['כל השבצק'] = snapshot['כל השבצק'].filter((r) => !(…));   // injected
  ```

  Copy `ab-recommendations.mts` to `apps-script/tools/.ab-injected.mts` (the
  `REPO` constant is relative to that directory, so it must live there), run it,
  delete it. Removing **one** history row made the long-exit branch produce its
  cell on real data, and that is what "the branch works, the snapshot just has
  no case for it today" is allowed to mean.

Whichever you can't show, say so explicitly in the report. "No regression" and
"the case never occurred" look identical in the output.

### Throwaway snapshot probes

The repo root is full of git-ignored `.<name>.mts` one-offs
(`.presence-census.mts`, `.probe-engine.mts`, `.tours.mts`, …) — the established
way to ask the live sheet a question. They all re-implement the same 15 lines:
read `.env`/`.env.local` by hand, base64-decode `GOOGLE_SERVICE_ACCOUNT_KEY`
into a `GoogleAuth`, then `values/<tab>?majorDimension=ROWS`. Copy the block at
the top of `apps-script/tools/ab-recommendations.mts` rather than writing it
again. ⚠ The file must sit **inside the repo** — `node_modules` is not resolved
from a scratchpad directory, so `google-auth-library` fails to import there.

## The two halves model the same concepts separately — and drift

`ShabtzakOps.js` validates and `ShavtzakRecommendation.js` scores, and each
carries its **own** notion of what a mission is worth. They are not derived from
one another and nothing flags a disagreement: the validator just keeps passing
schedules the engine would never recommend, and vice versa.

Found 2026-08-10 on `כונן גשש`: Ops had always given it `hoursForDailyTotal = 0`
and filtered it out of `validateDailyHours_`, exactly like כרמל — while the
engine charged **8 hours** per shift into both the 7-day `totalHours` (weight
1.4/h) and the same-day cap. A tour descender looked like a 16-hour day on one
side and an 8-hour day on the other. The v2.7 comment shows it was a deliberate
engine-side choice that Ops never followed; either way, nobody noticed for a
year.

So when you change how a mission type is **counted** — hours, blocking, rest,
rotation class — grep the same concept in the other file before assuming your
side is the whole story. Concretely, `isCarmel / isAttackReadiness / isTracker`
in Ops answer the same question as `isKonenutCategory_ / trackerKeywords` in the
engine, and the answers were allowed to differ.

Related trap in the engine alone: `isKonenutCategory_` is not just an hours
flag. It also drives `isSkippedRecommendationTask_`, the blocking rules and the
"yesterday" window — folding a category into it to zero its hours silently stops
that category getting recommendations at all. Change the two hour counters
(`calculateStats_`, `calculateSameOperationalDayHours_`) instead.

### Writing engine tests: put the history on the right operational day

`tests/apps-script-*.test.ts` drive `updateShabtzakRecommendations()` end to end
over a synthetic three-tab spreadsheet (copy the harness from
`apps-script-tour-driver.test.ts` or `apps-script-tracker-tour-descent.test.ts`).
Two ways a test silently exercises nothing:

- **A pre-14:00 row belongs to the previous op day.** A `06:00-14:00` סיור and a
  `14:00-22:00` shift on the same date are *not* the same operational day, so
  same-day load, streaks and "already assigned today" never engage. To test
  those, pair `14:00-22:00` with `22:00-07:00`. A history row dated on the tab's
  own base date is dropped entirely — history keeps only op days strictly before
  the current one.
- **The candidates cell holds names only.** Reasons (`✓ לא היה כונן גשש עד היום`,
  workload, warnings) live in the row **note**, and for an unassigned row the
  note lists just the top few candidates. Assert reasons against an *assigned*
  row, whose note is that one soldier's full evaluation. Capture notes by
  recording `setNotes` in the fake sheet, alongside `setValues`.

The lighter harness in `apps-script-vacation-change-time.test.ts` /
`apps-script-previous-away.test.ts` skips the spreadsheet entirely and calls
`evaluateCandidateForTask_` with a hand-built context. Build its inputs with the
engine's own constructors — `buildTaskFromFields_` for a task,
`taskToAssignment_(buildTaskFromFields_(…))` for a history row — so the shapes
can't drift from what the real reader produces.

⚠ **`assert.deepEqual` against anything the vm built fails on empty arrays and
plain objects.** `assert/strict` compares prototypes, and `[]` created inside
`vm.createContext` belongs to that realm's `Array`, not the test's — injecting
`Array` into the context does not change what a literal uses. `deepEqual(x, [])`
throws with an unhelpful diff of two identical-looking `[]`. Assert `.length`,
or compare field by field. `Date` is unaffected, because the harness injects it
and the scripts call `new Date` rather than using a literal.

## The 14:00 operational day — a grouping, not a second date convention

This one has burned two agents (and this skill's first draft). Get it right:

**תאריך in `כל השבצק` is always the literal calendar day of the row.** Verified
against the sheet: within a single operational day, the 18:00 and 22:00 rows
carry `11/08` while the 02:00, 06:00 and 10:00 rows carry `12/08`. The `שבצק`
tab's own header says the day runs *"שבת ב14:00 עד ראשון ב14:00"* — and it still
writes each row under its true calendar date.

So the operational day is a **grouping over literal dates**, computed by
`operationalDayOfDateTime_(calDate, minutes)` (before 14:00 → the op day that
started yesterday). `normalizeToOperationalDay_` adds 24h to pre-14:00 times only
on the *internal* minute axis, so shifts within one op day can be compared and
sorted. Neither rewrites what a date means.

This does **not** contradict `CLAUDE.md`'s "Sheet dates are LITERAL" — that rule
forbids a *viewer* surface from inventing a rollover, and the script doesn't
invent one either. Both are true simultaneously. What is still forbidden: giving
the viewer an operational-day anchor (pinned by `tests/shavtzak-display.test.ts`,
`tests/personal-schedule.test.ts`).

The old `calendarDateForOpDaySlot_` carried a comment implying the written date
was the *op* day. It was never called, it was the source of the confusion, and
v3.11 deleted it. If you find yourself concluding the two halves disagree,
re-read this section before acting.

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
