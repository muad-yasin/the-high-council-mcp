# Visual verification in detail, generated assets, and tooling

## Verification

- **Captures catch what property reads can't.** Real, otherwise-invisible bugs found only by a capture: geometry that exists but renders fully hidden behind an opaque element at the same depth; a color-parsing bug that silently blew a value out to white while the stored value looked plausible on paper.
- **Live-iteration captures lie about persistence.** Edits in an editor or hot-reload session can revert the instant the session ends. Redo the accepted value as a deliberate persisted edit, save it, and re-verify with a capture from a fresh session.
- **Wide and close framings find different defects** - occluded detail, illegible small elements, a silhouette that doesn't read.
- **Drift over time:** to find where a loosely-followed style guide or a fixed palette broke, compare representative pieces from different points in the timeline under identical conditions. The divergence locates the break; re-reviewing everything from scratch does not.
- **A second, less-invested read when stakes justify it.** Whoever built something sees what they intended. A fresh look - after a break, from a different capture, or from a separate reviewer - catches what one continuous session won't.
- **Vision-model reads.** Models anchor on a plausible description over the actual pixels, and their quality judgments are unstable across repeated asks. Counter it structurally: diff against a reference, name the heuristic first, describe before judging, crop to the asset, sample more than once. The evidence covers measurable drift and quality, not artistic taste - keep a human as the judge of style.
- **Contrast and color-vision checks** use the WCAG 2.x relative-luminance formula on colors sampled from a real capture, plus a simulator for the common color-vision deficiencies. Newer perceptual contrast models exist but are not a conformance standard yet; use them as a second opinion, never instead.

## Generated and procedural assets

- **Write acceptance criteria before generating**, judged at the size the end user sees - not generation resolution.
- **Tells of a structurally generic result:** a perfect silhouette with no distinguishing geography; no hierarchy (nothing draws the eye first); uniform distribution with no focal weighting; reliance on one narrow palette family. Fine surface detail cannot rescue a generic structure - fix the structure first.
- **Decide what free-tier generation is for.** If it is for exploring a prompt formula, don't let a free-tier result quietly become the shipped asset.
- **Keep a small reference library** - accepted assets, reference images, a written style recipe or prompt template - as the source of truth for "on-brand." It is cheaper and more durable than re-deriving style from memory.

## When a separate design tool earns its cost

A dedicated mockup tool pays for itself on two things: coordinating visual decisions across more than one person, and validating an expensive layout *before* paying to build it. If neither applies - a solo builder whose implement-and-capture loop is already about as fast as mocking up - the round trip through a separate tool adds cost without removing any. Revisit when a second person joins visual work, or a specific layout is expensive enough to get wrong that a cheap mockup pays even solo.
