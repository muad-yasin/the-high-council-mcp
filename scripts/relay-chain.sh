#!/usr/bin/env bash
# Runs an idea through two harness passes, feeding pass 1's deliverable into
# pass 2 as context. You name both chains (since 0.8.2 there is no default
# chain): chain1 for breadth, for example cheap-7-v2 (7 cheap-tier labs stress
# the idea), then chain2 for depth, a smaller panel that tightens what survived.
#
# Usage: scripts/relay-chain.sh tasks/idea.md chain1 chain2
#
# For a third pass, re-run this script with pass 2's deliverable.md as the
# new idea file and a heavier chain as chain1 - only if pass 2 still looks shaky.
set -euo pipefail

IDEA_FILE="${1:-}"
CHAIN1="${2:-}"
CHAIN2="${3:-}"

if [ -z "$IDEA_FILE" ] || [ ! -f "$IDEA_FILE" ] || [ -z "$CHAIN1" ] || [ -z "$CHAIN2" ]; then
  echo "Usage: scripts/relay-chain.sh tasks/idea.md chain1 chain2   (name both chains: there is no default chain since 0.8.2)" >&2
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
