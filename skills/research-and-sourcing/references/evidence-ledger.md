# Evidence ledger, source tiers, and research briefs

## Source tiers

| Tier | Examples | Can carry alone |
|---|---|---|
| **Primary** | The document itself: official docs, changelogs, specs, filings, court records, the paper, the repository, first-party pricing pages | Figures, versions, dates, quotes, rulings |
| **Reputable secondary** | Established news with named reporting, peer-reviewed surveys, well-known reference works | Context and characterization; trace figures to primary where possible |
| **Practitioner** | Named engineers' posts, conference talks, postmortems | Practice and failure-mode reports, labeled as practitioner evidence |
| **Vendor** | Marketing pages, vendor-authored "studies" | Only that the vendor claims it; label "vendor-sourced" |
| **Aggregator / SEO** | Listicles, rewritten roundups, unattributed summaries | Leads only - never a citation |

A "vendor-sourced" or "directional" figure can appear when labeled as such. Removing the label is the failure.

## Evidence grades

- **Strong** - primary source, or several independent sources agreeing.
- **Moderate** - one reputable source, or consistent practitioner reports.
- **Inferential** - derived from indirect evidence (product shape, adjacent findings). Say what it was inferred from.
- **Proposed** - an untested idea. Never presented as a finding.

Grade per section or per claim, and carry the grade through every summary built on top. When evidence is thin, say so in the finding rather than letting a confident sentence stand in for it - for example, "the tendency toward silent failure is well sourced; the specific claim that models mis-trace derivations has no direct study behind it and is inferred."

## Claim ledger format

```
| # | Claim (paraphrased) | Source (URL) | Tier | Doc/Inf | Read on | Setup for any number |
|---|---------------------|--------------|------|---------|---------|----------------------|
| 1 | ...                 | ...          | Primary | Doc  | 2026-..  | benchmark X, models Y, date Z |
```

Keep one ledger per research output. Anything that later cites a finding cites the ledger row, not a paraphrase of a paraphrase.

## A research-slice brief (for yourself or a delegated worker)

```
Question:     <one bounded question>
Why:          <what decision this feeds>
Boundary:     <source types in scope; what's out of scope>
Already known / ruled out: <so it isn't re-searched>
Output:       <claim ledger + short findings; word limit>
Stop when:    <enough to decide, or N sources, or budget>
Rules:        primary sources for figures; mark documented vs inferred;
              no verbatim third-party text; dates on anything that moves
```

Vague research briefs produced duplicated searches and coverage gaps in one published multi-agent research system (Anthropic, 2025); a complete brief is cheaper than the rework.

## Recurring traps

- **The confident absolute.** An invented summary tends to say "every," "never," "the only." Treat absolutes as a prompt to open the primary document.
- **The quota trap.** "Two sources per claim" is satisfiable without being met in spirit - two copies of one press release pass the count and fail the property. A count is a floor beneath judgment, never the test.
- **Dated requirements.** Platform and regulatory numbers (store requirements, API limits, compliance deadlines) are revised regularly. Record when each was checked and re-verify by fresh search before acting on an old note.
- **Research that answers "whether."** Research can establish how something works; whether to build, buy, or pursue it stays the owner's decision. Present findings, not a decision disguised as one.
