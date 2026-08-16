---
name: parallel-execution
description: Run several substantial, independent fixes/features concurrently across isolated git worktrees, then merge them into one review branch. Covers task→agent grouping by file-scope, per-agent isolated test databases, model selection, sequential merge + integrated verification, and cleanup. Use when the owner hands you a batch of independent scheduler/viewer changes and asks to "spin up agents in parallel" onto a single branch.
---

# Parallel execution (worktree fan-out → one review branch)

The owner's working style (see CLAUDE.md): **subagents for LARGE independent
tasks only**. This skill is the mechanics for exactly that case — a batch of
independent fixes that should land on one branch with per-task commits.

## 0. Before dispatching — explore + decide

1. **Map first, in parallel.** Spawn a few read-only `Explore` agents over
   disjoint areas (scheduler core / viewer+API / DB+auth). Ask for `file:line`
   maps, not file dumps. Feed those maps verbatim into the implementation agent
   prompts so agents don't re-explore (saves tokens).
2. **Ask the owner only genuinely-blocking decisions** (design choices, destructive
   policies, ambiguous rules) via AskUserQuestion — batch up to 4, use `preview`
   for code/mechanism comparisons. State reasonable defaults for the rest in prose.
   Questions in English; Hebrew domain terms are fine in labels.
3. If any piece is "plan-first-for-approval", present that plan and gate ONLY that
   agent on approval; start the rest immediately.

## 1. Group tasks into agents by FILE SCOPE, not by task number

The single most important rule: **tasks that touch the same files go in the SAME
agent** (they run sequentially inside it, coherently). Only put tasks in *different*
parallel agents when their file scopes are largely disjoint. Overlap that is
unavoidable across agents (e.g. `report.ts`, `schema.sql`, a shared React
component) is fine — it becomes a merge conflict you resolve once, not a race.

Example grouping from the 2026-07-24 batch (8 fixes → 4 agents):
- **scheduler-logic** (rank/level1/level2/validate/rationale + SPEC/LOGIC) — all
  the priority-rule + driver changes; heavy mutual overlap → one agent.
- **display-ordering** (new shared helper + report.ts sort sites + one viewer component).
- **חמל tab** (new API + new component + App.tsx + schema delta) — mostly net-new.
- **draft-lifecycle** (api/draft.ts + persist.ts + schema delta + DraftSchedule.tsx)
  — report persist + publish flow; share files → one agent.

## 2. Model per agent (cost-tuned)

- **Opus** — correctness-critical logic (scheduler rules), features with auth /
  generator interaction. Default for anything subtle.
- **Sonnet** — well-scoped, mostly-mechanical work (a self-contained display helper).
- **Fable** — when a piece needs genuine up-front design; consider Fable-design →
  Opus-implement for the hardest pieces. (In practice a strong Opus prompt with an
  explicit "write the design first, then implement" step usually suffices.)

## 3. Isolation: one worktree per agent

Spawn each implementation agent with `isolation: "worktree"` and
`run_in_background: true`. First create the integration branch and check it out in
the main repo so worktrees fork from it:

```bash
git checkout -b fixes/<batch-name>   # off main
```

Each agent's prompt MUST start by creating a well-known branch so you can find it
later: `create+checkout branch agent/<name> off current HEAD`.

⚠ **Never tell an agent to make its own worktree.** An agent spawned with
`isolation: "worktree"` is *pinned* to the one it was given: Bash refuses any
command whose cwd resolves outside it, `EnterWorktree` will move the agent's cwd
to a second worktree but Bash stays pinned to the first — every command then
fails with "this session is isolated in …" — and `ExitWorktree` refuses outright
from a pinned agent. The only way out is `EnterWorktree` back to the original.
A prompt that opens with `git worktree add … && cd …` (a natural thing to write
when you want the agent isolated) therefore bricks the agent before it starts.

Isolation is the harness's job. Give the agent the **branch** to create, and let
it work in the worktree it already has. Two more consequences worth knowing:

- `git worktree add … <branch>` run from inside a worktree fails with
  `fatal: invalid reference` when that branch is checked out elsewhere — pass a
  commit sha instead if you really need one.
- Renaming a branch that an agent was told to fork from breaks its setup step.
  Tell the agent the sha, or tell it about the rename immediately.

## 4. Isolated test database per agent (critical gotcha)

(`scheduler/tests` was deleted 2026-08-16 — the scheduler is frozen and untested.
This section now applies only to root `tests/*.test.ts` files that hit a Postgres
test DB.) DB-backed suites run **serially against one shared `shavtzak_test` DB** —
parallel agents running them at once WILL collide. The harness keys off
`SCHEDULER_TEST_DATABASE_URL`, so give each agent its own DB. A fresh-schema
helper drops/recreates the *schema* but NOT the database, so pre-create them first:

```bash
docker start shavtzak-pg   # (create if missing per CLAUDE.md); wait for pg_isready
for db in shavtzak_test_sched shavtzak_test_display shavtzak_test_hamal shavtzak_test_lifecycle; do
  docker exec shavtzak-pg psql -U postgres -tc "select 1 from pg_database where datname='$db'" \
    | grep -q 1 || docker exec shavtzak-pg psql -U postgres -c "create database $db"
done
```

Tell each agent to run:
`SCHEDULER_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/shavtzak_test_<x> npm test`

## 5. Standing instructions for every implementation agent

- Scope guard: **only DB-based scheduler/draft (שבצק טיוטה) logic — never the
  Google-sheet-based live viewer behavior.** Read CLAUDE.md + SPEC/LOGIC first.
- `npm install` in the worktree (root and/or `scheduler/`) — **node_modules is NOT
  copied into worktrees**, so tests fail without it.
- Tests REQUIRED per change (own test DB) + `npm run typecheck`; React changes also
  `npm run build` at root. **Never touch Supabase** — local only.
- DB changes = a standalone delta file under `scheduler/db/` **plus** update baseline
  `schema.sql`/`seed.sql` (FK-identity + reuse-existing-config rules still apply).
- SPEC.md and LOGIC.he.md both updated for any rule change (owner checks they match).
- Coordination notes: name the files another agent owns and tell each agent to keep
  edits in separate regions (e.g. "don't touch report.ts crew-sort; another agent owns it").
- Report back: branch name, files changed per task, test results, and every design
  decision / caveat.

## 6. Merge sequentially, then verify the integrated tree

Merge agent branches one at a time into the integration branch (first merge is
always clean). Expect conflicts only in the known shared files; resolve by
**combining** (e.g. a component whose prop signature grew on both sides — keep all
props, use the richer fallback object).

```bash
for b in agent/sched agent/hamal agent/lifecycle agent/display; do
  git merge --no-ff "$b" -m "Merge $b: ..."   # resolve conflicts, git add, commit
done
git grep -n '<<<<<<<'   # must be empty
```

Then run the FULL suite on the merged tree (fresh `shavtzak_test`) + root
`npm test` + `npm run build`. **Integration reveals misses the agents couldn't
see** — classic: one agent adds a field to an API response, an *existing* test in
another area does an exact-match assertion and now fails. Fix on the integration branch.

## 7. Cleanup + hand-off

```bash
for id in <agent-worktree-ids>; do git worktree remove --force ".claude/worktrees/agent-$id"; done
git worktree prune
git branch -D agent/sched agent/hamal agent/lifecycle agent/display
```

Do **not** push or merge to main unless asked (commit-only default; main = Vercel
prod). Leave the branch ready for review and produce a status report (HTML artifact
works well) covering each request's status + caveats + action items (e.g. "apply the
DB deltas to Supabase", "set SCHEDULER_DATABASE_URL in Vercel", security findings).

## Security-review notes

Background commit review will (correctly) flag new write endpoints that lack
server-side auth. Today ALL `api/*` endpoints are open/client-gated by design
(server-side Clerk auth is a tracked "next candidate"). Acknowledge, keep consistent
with existing endpoints, and surface it as a report caveat rather than bolting auth
onto one endpoint.
