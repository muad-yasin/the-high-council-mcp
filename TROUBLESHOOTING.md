# Troubleshooting

Every code below is printed wherever it happens - in your terminal, in a run's own
`run.log` - so you can search for it here. `degradable` means you can fix it and
keep going; `fatal` means this particular invocation stops here.

## COUNCIL-E001 - Missing API key (degradable)

The "\<provider\>" API key isn't set, so the chain can't call that lab. An API key
is what proves to that provider a request is yours to pay for - without it, every
call to that lab fails before it starts.

**Fix:** set the matching environment variable in your `.env` file. See
[README.md#setup](README.md#setup) for the full list of variable names.

## COUNCIL-E002 - Unpriced model (degradable)

A provider/model pair has no listed price, so its cost can't be shown or added to
your spend total. A price is the per-token rate this program uses to add up what
a run will cost before you pay for it.

**Fix:** add an entry for that provider/model to `src/pricing.json`. See
[README.md#the-spend-cap](README.md#the-spend-cap).

## COUNCIL-E003 - Malformed chain file (fatal)

The chain file isn't valid JSON, so it can't be read at all. A chain file is the
plain JSON config that says which models fill which seat - a syntax error
anywhere in it stops the whole file from parsing.

**Fix:** check the named file for a missing comma, bracket, or quote. See
[README.md#chains](README.md#chains).

## COUNCIL-E004 - Unreadable stage reply (degradable)

A lab's reply for one stage couldn't be read as the JSON that stage expects. A
stage reply is one lab's structured answer for one step of the chain - an
unreadable one is treated as an abstention, not a failure, so the run continues
without it.

**Fix:** read the saved reply at `runs/<run-id>/<stage-label>.md` to see what that
lab actually returned. The run log also says why it was unreadable: truncated
(hit its token cap), malformed JSON, or the provider itself returned an error
mid-generation - each needs a different fix (a higher `maxTokens`, a smaller
prompt, or just retrying).

## COUNCIL-E005 - Policy refusal (fatal)

Either `policy.json` itself isn't valid JSON, or the chain you're about to run
violates one of its limits (an unlisted provider or region, over the per-run or
per-month spend cap, a missing required tag, or an unpriced seat when
`refuse_unpriced_seats` is set). A policy file is a locked, operator-set set of
limits checked before any provider is called - a run that would violate it never
starts, so nothing was spent.

**Fix:** if the file itself won't parse, fix its JSON syntax. Otherwise, either
change the chain so it no longer violates the listed limit(s), or change
`policy.json` if the limit itself was wrong. See [docs/policy.md](docs/policy.md).
