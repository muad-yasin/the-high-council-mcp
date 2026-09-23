<!-- MOCK RUN ONLY. Generated offline from the mock provider (src/providers.js), never from a real run. -->
# Example: ARGUED.md from a mock run

This is what the opt-in `argued: { enabled: true }` stage writes, produced **entirely offline on mock seats**:
mock-debate with the alternatives stage, decision records and a holdout critic that forces the dispute stage.
The mock writer fills the fixed section layout from the fact pack, so the wording is mechanical; a real
handoff seat (in plan-7, the external Claude Code session) writes the prose. The labs, ids and texts below are
mock fixtures, not real models or real run content. No quality claim is made for the section.

---

# How this plan was argued

This page explains how 3 AI labs argued over the plan: 2 whole architecture(s) (overall designs) and 2 proposed part(s) were on the table, and 2 objection(s) were raised.

## The big options

- Architecture from mock-proposer-a was amended by its author (`MOCKA-ALT`). Its weak spot, in its own words: mock: high write volume.
- Architecture from mock-proposer-b was amended by its author (`MOCKB-ALT`). Its weak spot, in its own words: mock: high write volume.

## The objections and how the authors answered

- `MOCKB-1`: `mock-a` objected ("Quote: "mock.js" - no such file exists."). The author then amended the part ("Fair."). In the plan: unaccounted.
- `MOCKA-1`: `mock-b` objected ("Quote: "mock.js" - no such file exists."). The author then amended the part ("Fair."). In the plan: unaccounted.

## What is still disputed

- `mock-holdout` still objects on "It states the assumptions it was written under.": No assumptions section.

## Where each lab stood

- `mock-a`: proposed 1 part(s), 0 accepted in the plan; raised 1 objection(s); final verdict: signed off.
- `mock-b`: proposed 1 part(s), 0 accepted in the plan; raised 1 objection(s); final verdict: not on the panel.
- `mock-holdout`: proposed 0 part(s), 0 accepted in the plan; raised 0 objection(s); final verdict: objected.

---

## What report.json records for it

```json
{
  "argued": {
    "file": "ARGUED.md",
    "facts_counts": {
      "labs": 3,
      "alternatives": 2,
      "proposals": 2,
      "debate_posts": 2,
      "objections": 2,
      "objected_proposals": 2,
      "withdrawn": 0,
      "amended": 2,
      "declined_objections": 0,
      "unresolved_objections": 1
    },
    "unknown_refs": [],
    "unknown_labs": [],
    "missing_labs": [],
    "missing_sections": [],
    "refs_cited": 7,
    "ok": true
  }
}
```

## The check catching invented debate

The same run with the mock writer `mock-argued-inventor`, which adds one sentence about a debate that never
happened. The text is kept as written; the harness flags it:

> A fourth option, a serverless design, was argued down by `phantom-lab` (`PHANTOM-9`).

```json
{
  "unknown_refs": [
    "PHANTOM-9"
  ],
  "unknown_labs": [
    "phantom-lab"
  ],
  "missing_labs": [],
  "missing_sections": [],
  "refs_cited": 7,
  "ok": false
}
```

WARNINGS.md gets:

```
- argued_unknown_ref: ARGUED.md cites id(s) the run never produced: PHANTOM-9
- argued_unknown_lab: ARGUED.md names lab(s) or token(s) not in the run: phantom-lab
```
