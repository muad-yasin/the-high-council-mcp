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
| # | Claim (paraphrased) | Source (URL) | Tier | Doc/Inf | Read on, and how much | Moves | Setup for any number | Terms/licence (data sources only) |
|---|---------------------|--------------|------|---------|-----------------------|-------|----------------------|-----------------------------------|
| 1 | ...                 | ...          | Primary | Doc  | 2026-.., section 3 only | fast | benchmark X, models Y, date Z | clause for the intended use, with date |
```

Keep one ledger per research output. Anything that later cites a finding cites the ledger row, not a paraphrase of a paraphrase.

"How much" is the abstract, a named section, or the whole document. "Moves" is how fast the fact can change - stable (a published paper's result), slow (a standard, a licence), fast (a price, a version, an API limit, a model's behaviour) - so a later pass re-checks the fast rows and leaves the stable ones alone.

Beside the ledger, keep a short list of the points where independent sources disagree, each with what would settle it. A finding that rests on one side of such a point says so.

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
- **The useful source that forbids the use.** A dataset, tile service or generated asset can answer the question and still bar the use you have in mind (analysis, extraction, redistribution, offline copies). Read the terms before building on it, record the clause and its date, and look first at what is already held and cleared - the legal equivalent is sometimes already in the inventory, unused.
- **Popularity as vetting.** Stars, downloads, and a recent commit date say that many people looked or that someone is active. None of them is a review of the content, and a widely copied mistake is still a mistake.
- **The abstract standing in for the paper.** An abstract states the headline result and leaves out the setup, the limits and the cases that went the other way. A ledger row read from an abstract says so, and carries no claim the abstract does not make.
- **The newest docs for an older install.** Documentation pages default to the latest release. Take the installed version from the lockfile first, then open that version's page; where the code and the page still disagree, the owner hears about it before anything is changed to match.
- **Research that answers "whether."** Research can establish how something works; whether to build, buy, or pursue it stays the owner's decision. Present findings, not a decision disguised as one.
