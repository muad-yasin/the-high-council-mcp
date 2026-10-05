# Machine-writing tells - the evidence and its limits

Everything here is a **rejector or an advisory flag**, never a style target. Read the cautions at the bottom before using any of it. Most sources were last checked against their primary text on 2026-10-04 (the research papers and the practitioner page read in full; two newspaper analyses cited in the Wikipedia list were not opened). **Word lists are dated snapshots:** see "The vocabulary moves" below.

## How strong the evidence is

**Strong - a large-sample, peer-reviewed vocabulary shift.** Kobak, González-Márquez, Horvát and Lause, "Delving into LLM-assisted writing in biomedical publications through excess vocabulary", *Science Advances* 11(27), 2025 ([doi:10.1126/sciadv.adt3813](https://doi.org/10.1126/sciadv.adt3813); preprint [arXiv:2406.07016](https://arxiv.org/abs/2406.07016)). Across about 15.1 million PubMed abstracts from 2010-2024, they found an abrupt excess of style words after chat assistants became widely available, and estimated that at least 13.5% of 2024 abstracts were processed with an LLM - reaching 40% in some subcorpora. Their strongest excess words were *delves* (about 28 times the frequency its pre-2023 trend predicted, r = 28.0), *underscores* and *showcasing*; they also cite earlier work flagging *intricate, meticulously, pivotal* and *realm*. The setup matters: biomedical abstracts, one period, a frequency method. It shows which words surged in one genre, not that any one word proves authorship.

**Moderate - a large preprint on fiction.** Russell et al. (five authors in the current version), "StoryScope: Investigating idiosyncrasies in AI fiction" ([arXiv:2604.03136](https://arxiv.org/abs/2604.03136), 2026, version 6 of 10 August 2026; no venue shown at last check). On about 61,600 stories, AI narrators stated the story's theme outright 77% of the time against 52% for human writers. This is the structural tell - over-explaining. That it outlasts surface edits better than vocabulary does is an inference from its being structural, not a measured result.

**Moderate - stylometry.** Chen, Xiong, He and Ross, "Stylometric detection of AI-generated texts: evidence from human and machine-written essays", *Digital Scholarship in the Humanities*, 2026 ([doi:10.1093/llc/fqag064](https://doi.org/10.1093/llc/fqag064)). On paired essays, machine text showed marked stylistic uniformity where human writing was more variable - the shape behind "metronomic rhythm".

**Practitioner - named thresholds, not research.** A 2026 practitioner catalogue ([SlopDetector, "Signs of AI Writing"](https://slopdetector.org/blog/signs-of-ai-writing)) states reproducible flag thresholds; they are heuristics, labelled as such below. A community-maintained list, [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), collects the same families of patterns from editors' cleanup work.

## Vocabulary

**The vocabulary moves.** Marker words change by model generation and fade once they are named. *Delve* fell sharply in the months after it was pointed out in early 2024 (Geng and Trotta, "Human-LLM Coevolution: Evidence from Academic Writing", Findings of ACL 2025), and community lists now sort their words by model era. Treat every list below as a snapshot dated October 2026 and re-check it each release. That the structural tells (over-explaining, metronomic rhythm) have not drifted the same way is an inference, not a measured result.

- **The focal set** - the words above, plus the practitioner-reported family *tapestry, testament, landscape, foster, crucial, comprehensive, robust, seamless, vibrant, multifaceted, transformative, paramount*.
- **Inflated verbs** where a plain one fits - *leverage, utilize, harness, streamline, empower, elevate, unlock, facilitate*.
- **Flattering descriptors** - *inspiring, heartwarming, remarkable, fascinating, compelling*. A praise adjective asks the reader to take a claim on faith; a detail is evidence they judge. Cut the adjective, keep the detail.
- Practitioner thresholds (heuristic): more than about 3 flagged style words per 500 words; an inflated verb more than once per 300 words.

## Structure

- **Negative parallelism** as rhythm - "not just X, but Y", "It's not X. It's Y." An old, legitimate figure; reflexive use is the tell.
- **Reflexive triplets** installed for cadence. Practitioner threshold: more than one polished triplet per 200 words.
- **The false range** - "from X to Y" implying a spectrum that isn't there.
- **Signposting filler** - "it's important to note", "at its core", "when it comes to", "in today's fast-paced world". Practitioner threshold: two or more empty openers per 500 words.
- **Transition stacking** - *Furthermore, Moreover, Additionally* opening most paragraphs.
- **The summary closer** - a final sentence opening "Ultimately", "In conclusion", "In the end". A hard rejector on craft grounds alone.

## Rhythm

**Metronomic rhythm** - every sentence in one length band. Often measured as sentence-length standard deviation divided by the mean ("burstiness"); the practitioner catalogue flags values under 0.4. **Don't fix this by installing variety** - varied rhythm is an output of having something to say.

## Punctuation - the em dash

The most-discussed marker and the weakest evidence. Human usage varies hugely: one small preprint sample of published essays (Freeburg, "The Last Fingerprint: How Markdown Training Shapes LLM Prose", [arXiv:2603.27006](https://arxiv.org/abs/2603.27006), 2026; eight essays) found a weighted mean of about 3.2 per 1,000 words with a range from 0.33 to 17, while the practitioner catalogue above reports roughly 3.7 to 10 per 1,000 words across more than 700,000 words of published prose (*Huckleberry Finn* at about 10; read 2026-10-04). The practitioner flag sits above 20 per 1,000 words. Use that page for its thresholds only: its figures for the Kobak study differ from the paper, and practitioner pages change silently, so cite them with the date read. **Density is weakly informative and a single dash is nothing**, and vendors have reportedly begun tuning it per model (press reports of 2025-26, for example that one 2025 model release suppressed it; not checked against a primary source), which weakens density further as evidence of authorship. It still reads as a tell to many readers, so the house rule stands: pick one structural break character and use only it.

**The dash sandwich** is craft, not detection: a body sentence with two or more mid-sentence dash breaks fencing a parenthetical reads as a writer who couldn't decide on a clause order. **Split on paragraph boundaries before sentences** when counting, or joined paragraphs hide hits - one real sweep reported 8 against a true 11.

## Substance

**Nothing you can restate.** After a paragraph, name one concrete thing you now know - a name, number, date or mechanism. If more than about half the paragraphs fail, the text has no content however clean it is.

**Over-explaining the point** (see StoryScope above). The craft rule needs no number: delete the voice that tells the reader what to conclude.

## The cautions

1. **Signs, not proof.** Humans wrote every construction first. One sign is noise; several failing together in one short passage is the fingerprint. A deliberate, sincere use of a flagged construction is fine.
2. **Detectors are not a check, and running one on a person is a real harm.** Liang, Yuksekgonul, Mao, Wu and Zou, "GPT detectors are biased against non-native English writers", *Patterns*, 2023 ([arXiv:2304.02819](https://arxiv.org/abs/2304.02819)), ran seven detectors over 91 TOEFL essays by non-native writers: an average false-positive rate of about 61%, with 89 of 91 essays flagged by at least one detector, against near-perfect accuracy on US eighth-grade essays. The features detectors key on - simpler structure, commoner vocabulary - are features of writing in a second language. Never treat a detector score as evidence about someone's work.
3. **Don't write toward this list's inverse.** Prose visibly avoiding a word list has its own flatness. The goal is text that reads like someone meant it.
