#!/usr/bin/env bash
# Runs an idea through two harness passes, feeding pass 1's deliverable into
# pass 2 as context. Default shape: seven-cheap (breadth, 7 cheap-tier labs
# stress the idea) then verify (depth, Opus-tier critics tighten what
# survived). Override either chain by name if a different shape is wanted.
#
# Usage: scripts/relay-chain.sh tasks/idea.md [chain1] [chain2]
#
# For a third pass, re-run this script with pass 2's deliverable.md as the
# new idea file and "seven" as chain1 - only if pass 2 still looks shaky.
set -euo pipefail

IDEA_FILE="${1:-}"
CHAIN1="${2:-seven-cheap}"
CHAIN2="${3:-verify}"

if [ -z "$IDEA_FILE" ] || [ ! -f "$IDEA_FILE" ]; then
  echo "Usage: scripts/relay-chain.sh tasks/idea.md [chain1] [chain2]" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

echo "== Pass 1: $CHAIN1 (breadth) =="
node src/cli.js --task "$IDEA_FILE" --chain "$CHAIN1"
dir1=$(ls -td runs/*/ | head -1)
deliverable1="${dir1}deliverable.md"
echo
echo "Pass 1 deliverable: $deliverable1"

pass2_task=$(mktemp /tmp/relay-pass2-XXXXXX.md)
{
  echo "Original ask:"
  echo
  cat "$IDEA_FILE"
  echo
  echo "---"
  echo
  echo "A first review pass produced this plan:"
  echo
  cat "$deliverable1"
  echo
  echo "---"
  echo
  echo "Tighten this. Cut anything that did not survive scrutiny, sharpen anything vague."
} > "$pass2_task"

echo
echo "== Pass 2: $CHAIN2 (depth) =="
node src/cli.js --task "$pass2_task" --chain "$CHAIN2"
dir2=$(ls -td runs/*/ | head -1)
deliverable2="${dir2}deliverable.md"

echo
echo "Pass 1:        $deliverable1"
echo "Pass 2 (final): $deliverable2"
echo "Take the pass 2 deliverable into Claude Code to build."
