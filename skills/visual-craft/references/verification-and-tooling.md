# Visual verification in detail, generated assets, and tooling

## Verification

- **Captures catch what property reads can't.** Real, otherwise-invisible bugs found only by a capture: geometry that exists but renders fully hidden behind an opaque element at the same depth; a color-parsing bug that silently blew a value out to white while the stored value looked plausible on paper.
- **Live-iteration captures lie about persistence.** The rule and its scars are `frontend-developer`'s (`references/timing-lifecycle-input.md`): redo the accepted value as a persisted edit and re-capture from a fresh session.
- **Wide and close framings find different defects** - occluded detail, illegible small elements, a silhouette that doesn't read.
- **Drift over time:** to find where a loosely-followed style guide or a fixed palette broke, compare representative pieces from different points in the timeline under identical conditions. The divergence locates the break; re-reviewing everything from scratch does not.
- **A second, less-invested read when stakes justify it.** Whoever built something sees what they intended. A fresh look - after a break, from a different capture, or from a separate reviewer - catches what one continuous session won't.
- **Vision-model reads.** Models can anchor on a plausible description over the actual pixels, and their judgments can be inconsistent across repeated asks. Counter it structurally: diff against a reference, name the heuristic first, ask an open describing question before any judgment, crop to the asset, sample more than once. Keep a human as the judge of style.
- **Vision-model reads: the evidence (this reference owns it for the whole set).** (1) "MLLM-as-a-Judge" (Chen et al., ICML 2024, arXiv 2402.04788) found biases, hallucinated responses and inconsistent judgments even in GPT-4V; abstract page opened. (2) "Tinted Frames" (arXiv 2603.19203, March 2026) found that yes/no and multiple-choice framings draw markedly less attention to the image than open questions; abstract page opened. That is the basis for asking an open question first. (3) A separate line of work on visual sycophancy and temporal blindness (arXiv 2505.14321): vision-language models can follow a plausible textual framing over their own perception when the task is framed as an evaluation, and on several video benchmarks keep most of their accuracy when frames are shuffled, which suggests they use temporal order little; none of this measures artistic taste. (4) "When Vision-Language Models Judge Without Seeing" (ACL 2026, arXiv 2604.17768) reports that image content adds under 5% to the judges' verdicts and an informativeness bias of over 30-50%; seen through a search index's copy of the abstract only, so graded below the first two. None of the four measured artistic taste.
- **Contrast and color-vision checks** use the WCAG 2.x relative-luminance formula on colors sampled from a real capture, plus a simulator for the common color-vision deficiencies. Newer perceptual contrast models exist but are not a conformance standard yet; use them as a second opinion, never instead.

## Generated and procedural assets

- **Write acceptance criteria before generating**, judged at the size the end user sees - not generation resolution.
- **Tells of a structurally generic result:** a perfect silhouette with no distinguishing geography; no hierarchy (nothing draws the eye first); uniform distribution with no focal weighting; reliance on one narrow palette family. Fine surface detail cannot rescue a generic structure - fix the structure first.
- **Decide what free-tier generation is for.** If it is for exploring a prompt formula, don't let a free-tier result quietly become the shipped asset.
- **Keep a small reference library** - accepted assets, reference images, a written style recipe or prompt template - as the source of truth for "on-brand." It is cheaper and more durable than re-deriving style from memory.

## When a separate design tool earns its cost

A dedicated mockup tool pays for itself on two things: coordinating visual decisions across more than one person, and validating an expensive layout *before* paying to build it. If neither applies - a solo builder whose implement-and-capture loop is already about as fast as mocking up - the round trip through a separate tool adds cost without removing any. Revisit when a second person joins visual work, or a specific layout is expensive enough to get wrong that a cheap mockup pays even solo.
