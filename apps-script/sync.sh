#!/usr/bin/env bash
#
# Sync the sheet's bound Apps Script between Google and this repo.
#
#   ./apps-script/sync.sh status   what differs between Google and here (read-only)
#   ./apps-script/sync.sh pull     Google  -> repo   (pick up manual edits in the browser)
#   ./apps-script/sync.sh push     repo    -> Google (⚠ INSTANTLY LIVE for every user)
#
# There is no staging in Apps Script: this project has no web app, no library and
# no versions, so everything runs HEAD. A push is a deploy.
#
set -euo pipefail

PROJECT="plugat-gaash"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="$HERE/$PROJECT"
REL="apps-script/$PROJECT"

# Fingerprint of Google's content as of the last successful pull/push. Lives
# OUTSIDE the project dir on purpose — a .json inside it would be pushed to
# Apps Script as a source file.
STATE="$HERE/.sync-state"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
grn() { printf '\033[32m%s\033[0m\n' "$*"; }
ylw() { printf '\033[33m%s\033[0m\n' "$*"; }
die() { red "✗ $*"; exit 1; }

command -v clasp >/dev/null 2>&1 || die "clasp not found — npm i -g @google/clasp"
[ -f "$DIR/.clasp.json" ] || die "no $REL/.clasp.json"
clasp show-authorized-user >/dev/null 2>&1 || die "not logged in — run: clasp login"

SCRIPT_ID="$(node -p "require('$DIR/.clasp.json').scriptId")"
TMPDIRS=()
cleanup() { for d in "${TMPDIRS[@]:-}"; do [ -n "$d" ] && rm -rf "$d"; done; }
trap cleanup EXIT

# One hash over every source file in a directory (name + content, order-stable).
hash_dir() {
  ( cd "$1" && find . -maxdepth 1 -type f ! -name '.clasp.json' -print0 \
      | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1 )
}

# Fresh copy of what Google currently has, in a temp dir. Prints the path.
fetch_remote() {
  local tmp
  tmp="$(mktemp -d)"
  TMPDIRS+=("$tmp")
  ( cd "$tmp" && clasp clone "$SCRIPT_ID" ) >/dev/null 2>&1 || die "clasp clone failed for $SCRIPT_ID"
  rm -f "$tmp/.clasp.json"
  echo "$tmp"
}

read_state()  { [ -f "$STATE" ] && head -1 "$STATE" | cut -d' ' -f1 || echo ""; }
write_state() { printf '%s %s\n' "$(hash_dir "$DIR")" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STATE"; }

diff_dirs() { diff -ru -x '.clasp.json' "$1" "$2" 2>/dev/null || true; }

cmd_status() {
  local remote d last
  remote="$(fetch_remote)"
  last="$(read_state)"
  echo "script:  $SCRIPT_ID"
  echo "mirror:  $REL"
  echo

  d="$(diff_dirs "$remote" "$DIR")"
  if [ -z "$d" ]; then
    grn "✓ Google and the repo are identical"
  else
    ylw "Google (-) vs repo (+):"
    echo "$d"
  fi

  echo
  if [ -z "$last" ]; then
    ylw "⚠ no $STATE yet — run pull to record a sync point"
  elif [ "$last" = "$(hash_dir "$remote")" ]; then
    grn "✓ Google has not changed since the last sync ($(cut -d' ' -f2 "$STATE")) — safe to push"
  else
    red "⚠ Google CHANGED since the last sync ($(cut -d' ' -f2 "$STATE")) — someone edited in the browser."
    red "  Pull first; pushing now would erase their work."
  fi
}

cmd_pull() {
  ( cd "$DIR" && clasp pull )
  write_state
  echo
  if git -C "$HERE" rev-parse HEAD >/dev/null 2>&1 && ! git -C "$HERE" diff --quiet -- "$DIR" 2>/dev/null; then
    ylw "Google had changes that were not in the repo:"
    git -C "$HERE" --no-pager diff --stat -- "$DIR"
    echo
    echo "Review with: git diff -- $REL   then commit."
  else
    grn "✓ pulled — repo matches Google"
  fi
}

cmd_push() {
  local last remote
  last="$(read_state)"
  remote="$(fetch_remote)"

  # The only question that matters: did Google move since we last synced? If it
  # did, someone edited in the browser and a push would erase them. Local commits
  # are NOT drift — that is just work waiting to be pushed.
  if [ -z "$last" ]; then
    ylw "⚠ no sync point recorded ($STATE) — cannot tell whether Google moved."
    ylw "  Run pull first if you are not sure the repo is current."
  elif [ "$last" != "$(hash_dir "$remote")" ]; then
    red "✗ Google changed since the last sync — pushing would erase those edits."
    echo
    echo "Google (-) vs repo (+):"
    diff_dirs "$remote" "$DIR"
    echo
    echo "Run './apps-script/sync.sh pull', review, commit, then push."
    exit 1
  fi

  if [ -z "$(diff_dirs "$remote" "$DIR")" ]; then
    grn "✓ nothing to push — Google already matches the repo"
    return 0
  fi

  echo "Pushing $REL to script $SCRIPT_ID:"
  diff_dirs "$remote" "$DIR" | head -40
  echo
  red "This goes LIVE IMMEDIATELY for every user of the sheet. There is no staging."
  if [ "${1:-}" != "--yes" ]; then
    read -r -p "Type 'push' to continue: " answer
    [ "$answer" = "push" ] || die "aborted"
  fi
  ( cd "$DIR" && clasp push )
  write_state
  grn "✓ pushed — live now. Open sheets reload menus on refresh."
}

case "${1:-}" in
  status) cmd_status ;;
  pull)   cmd_pull ;;
  push)   shift; cmd_push "${1:-}" ;;
  *) sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
