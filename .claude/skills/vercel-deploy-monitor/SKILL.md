---
name: vercel-deploy-monitor
description: Check whether the latest pushed commit is live on the shavtzak Vercel deployment (shavtzak-gaash.site) — a token-free bundle-hash/marker poll that works today, plus the authoritative Vercel REST API method for when a token is set up.
---

# Monitoring a shavtzak Vercel deploy

The viewer app (repo root) deploys to Vercel via the GitHub integration:
**pushing to `main` triggers a production build automatically** (~1–2 min).
Live URL: `https://shavtzak-gaash.site/` — note it **308-redirects to
`https://www.shavtzak-gaash.site/`**, so always `curl -L`.

Two ways to confirm the latest commit is live. Method A needs no credentials
and is the default (there is no Vercel CLI, token, or `.vercel/` link in this
repo). Method B is authoritative (matches the exact commit SHA) but needs a
token.

## Method A — token-free: poll the served bundle (default)

Vite fingerprints the JS bundle by content, so **any code change produces a new
`/assets/index-<hash>.js` filename**. A deploy is live once the served hash
changes from the pre-push one — or, more precisely, once the served bundle
contains a marker from your new code.

```bash
SITE=https://www.shavtzak-gaash.site
bundle_hash() { curl -sL "$SITE/" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1; }

BEFORE=$(bundle_hash)           # capture BEFORE pushing
git push origin main
# ...then poll:
until [ "$(bundle_hash)" != "$BEFORE" ]; do sleep 15; done
echo "new bundle live: $(bundle_hash)"
```

**Content-marker check (more reliable than the hash alone)** — verify a specific
line of your change actually shipped, not just "something changed". Download the
bundle and inspect the minified source with Python (Hebrew-heavy `grep -E`
blows up on this file — "exceeds complexity limits"; use `python3` instead):

```bash
curl -sL "$SITE/assets/index-<hash>.js" -o /tmp/live.js
python3 - <<'PY'
d = open('/tmp/live.js', encoding='utf-8').read()
i = d.find('"company"&&')          # the tab-visibility filter
print(repr(d[i-40:i+90]))
j = d.find('primaryEmailAddress')  # the permission-gating block
print(repr(d[j:j+300]))
PY
```

Minified-name key for the gating logic (App.tsx `AppContent`), so you can read
the served bundle: `f` = `canSeeCompany` (`Qv.has(role)`), `m` =
`canSeeScheduler`, `Ox(...)` = `useIsShavtzakAdmin(email)`. Example — after the
"admins-only scheduler tabs" fix the bundle shows `m=Ox(o)` (scheduler gated by
admin alone); the pre-fix build showed `m` OR-ing in `f`. Minified identifiers
change between builds — re-derive them from the `primaryEmailAddress` block
rather than trusting these letters verbatim.

Limitation: this proves the front-end bundle updated. It cannot tell you which
git SHA it is, and it won't detect a change that only touched `api/*` serverless
functions (same bundle hash). For those, hit the changed endpoint directly, or
use Method B.

## Method B — Vercel REST API (authoritative, needs a token)

Matches the deployment's actual git commit and ready-state. Requires a token
(Vercel dashboard → Account Settings → Tokens). The API 403s unauthenticated.

```bash
VERCEL_TOKEN=...            # store in keychain: security add-generic-password -s vercel-token -a "$USER" -w
# find the project id once (or read .vercel/project.json after `vercel link`):
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/shavtzak" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])'

# latest PRODUCTION deployment: state + the commit it was built from
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=$PID&target=production&limit=1" \
| python3 -c 'import sys,json; d=json.load(sys.stdin)["deployments"][0]; \
print(d["readyState"], d.get("meta",{}).get("githubCommitSha"), d["url"])'
```

`readyState`: `QUEUED`→`BUILDING`→`READY` (or `ERROR`/`CANCELED`). The deploy of
`HEAD` is live when `readyState == READY` **and** `githubCommitSha` ==
`git rev-parse HEAD`. If the project sits under a team, add `&teamId=<id>` (or
`&slug=<team>`) to every call. Single deployment by id: `GET
/v13/deployments/{uid}`.

### Optional: make Method A exact by embedding the SHA

Add `define: { __COMMIT__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA) }`
to `vite.config.ts` (Vercel sets `VERCEL_GIT_COMMIT_SHA` at build time) and log
`__COMMIT__` once at startup. Then Method A can grep the served bundle for the
exact SHA — no token needed. Not wired up today; note the enhancement if exact
SHA matching becomes a recurring need.

## Waiting pattern

A production build is typically ready 60–120s after the push. Poll at ~15s
intervals; give up / warn after ~5 min (a stuck or failed build — check the
Vercel dashboard or Method B's `readyState == ERROR`).
