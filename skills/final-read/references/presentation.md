# Presenting reviewed work for sign-off

Once the pass is done, someone has to approve, edit or cut each piece. **How the batch is presented is a real design problem:** the person reading it is the bottleneck of the whole system, and a format that costs them thirty extra seconds per item costs hours across forty batches.

## The format

Short, fixed, per item. A shape that survived hundreds of items:

```
## N. <subject> (real: <real referent, if altered>)
**Layer 1** (N chars): the line
**Layer 2** (N chars): the line
**Consequence:** current -> proposed
**Body** (~N words): the full text
**Facts** ([Source](url), [Source](url)): the verified claims in plain prose, every source inline
**FACTS:** traced N / re-verified N / FLAGGED N - each flag and what was searched
```

Five things about it are load-bearing, each learned by getting it wrong:

1. **The body carries its full text, always.** Not "(unchanged)", not a summary of what changed. This crept in across four batches as an apparent courtesy, and it is the opposite of one: nobody can veto text they can't see, and "unchanged" is an unverifiable claim about the thing they're approving. It is worst where it feels most justified - proposing a paragraph break *to* a body that isn't shown.
2. **A proposed consequence is two values and a stop.** Current, proposed, done. Do the reasoning; don't ship it into the block. A proposal that needs three sentences of defence is usually wrong. If a choice genuinely turns on a judgment you can't make, add one short sentence below the block - rare enough to be read when it appears.
3. **Sources are inline links, in the block** - not a bibliography at the end, not "verified against two sources". The reviewer reads the sourcing, not just the punchline.
4. **Both names on the first line** wherever something was altered, so the alteration can be checked at a glance.
5. **Facts sit below the copy.** The reviewer reads the copy first and audits it second. An earlier version with three research blocks above the text cost more per item than it returned.

## Stop redesigning the format

The person signing off on one project asked, in effect, for the presentation format to stop changing: the time cost of a huge review task was the thing to optimise. A format they've learned to skim is worth more than a marginally better one they must re-learn. If a change is genuinely needed, propose it once as a change; don't just start using it.

## What leaves the presentation doesn't leave the work

The particulars are still captured and the one-sentence stance is still written - that is how the piece gets written at all. What changes is that the stance is vetoed through the piece that argues it. The honest cost: **a bad stance now takes a full draft to discover instead of one sentence**, so get the sentence right before drafting.

## Stop before publishing

Present the batch and **wait**. Approval, edits or cuts happen before anything becomes a live page, a scheduled post or a shipped asset. This is a standing rule, not a per-batch judgment - content review belongs to the owner, not to a session's bias toward speed (`tool-and-action-discipline`: human-stop gates are never skipped or faked).

**And the first thing an audience ever meets gets a human hand, however good the pipeline gets** - onboarding text, a launch announcement, the first article, a store description. Not because the pipeline is untrusted, but because those are the pieces where a miss can't be recovered.
