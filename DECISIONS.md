# Decisions

Records project decisions that aren't obvious from the code or commit messages.

## 2026-09-13: docs/demo.html added to answer the GP "interactive, not static" criterion

gp-6f's Golden Path judging pass flagged the Pages site as a static walkthrough with no
interactive element. Fix: `docs/demo.html`, a click-through reconstruction of a council run
(proposals, blind debate, keep/amend/withdraw replies, sign-off), built entirely with
`<details>`/`<summary>` - no `<script>`, no network calls, consistent with `docs/`'s existing
script-free rule (`test/landing-page.test.js`).

The data is hand-authored to match `report.json`'s real shape and explicitly banner-labelled
"SIMULATED DEMO · NOT A REAL RUN," not sourced from an actual run. This repo's own CLAUDE.md
forbids moving harness run output into the repo, since run folders can carry the author's
business and personal plans; a real `report.json` shipped as a public site asset would be
exactly that, unreviewed. `docs/board.html` already exists as the real-run counterpart (drawn
from an actual `report.json`, published as prose rather than a raw file) and the demo links to
it both ways so neither is mistaken for the other.
