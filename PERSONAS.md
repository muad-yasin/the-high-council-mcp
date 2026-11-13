# Personas

A seat's optional `role.persona` (see `src/seat-role.js`) is a name and voice directive layered
onto a debate-stage prompt - it changes how a seat *talks*, never what it's graded on (see
`src/personas.js`, `src/name-lint.js`). The default set, defined in `src/personas.js`:

- **Moses**
- **Noah**
- **Matthew**
- **Van Gogh**
- **Parzival**

These five are historical, religious and literary figures, chosen deliberately because none of them is
anyone's trademark. They are the default set of `role.persona`, a voice for a debating seat; the seat
names of `plan-the-high-council` are a different set, described below. That said, using any recognizable name as a software judge's voice is itself an
editorial choice: a public audience may read it as reverence, satire, or an implied endorsement by
association, in either direction. That reading is not intended, but it's real, and this file says
so plainly rather than leaving it for someone to notice on their own.

One flag, recorded once, on a decision that already stands: "Parzival" is the medieval literary
figure (Wolfram von Eschenbach), unambiguously public domain - the name is not anyone's IP. It is
also the alias the protagonist chooses in Ernest Cline's *Ready Player One* (novel and Warner Bros.
film), a work still under active copyright. The character name "Parzival" in that context is drawn
from the same public-domain legend and is not itself claimed as anyone's trademark, so the exposure
here is a secondary association in a reader's mind, not a legal one - worth having on the record,
not worth revisiting a decision already made.

A `role.persona` key that is not in the set in use is sent as a bare name, with no voice
directive; `council doctor` and a run's pre-flight list warn about each seat that names one (rule
`persona-unknown-key`, with the keys that do work). The retired `plan-premium-7` (in `chains/outdated/`) seats two such keys, `hypatia` and `avicenna`, next to the five
defaults: without a persona file of your own they reach the debate prompt as those names alone.

**You can replace the whole set.** `loadPersonas()` in `src/personas.js` reads an operator-supplied
JSON file (path via the `COUNCIL_PERSONAS_FILE` environment variable, or passed directly) and uses
it in place of the default five entirely - nothing in this repo needs editing to do that. A
persona file is a flat object keyed by the same short key your chain's `role.persona` field
references:

```json
{
  "your-key": { "name": "Public-facing name", "voice": "One or two sentences of voice directive." }
}
```

## The naming lint

`src/name-lint.js` scans every text file in this repository for name patterns matched against a
forbidden-name hash list, and fails loudly (not a warning) if any shipped file, doc, chain config,
task fixture, or prompt template contains one. This repository ships **no** forbidden names of its
own - the default list is empty. An operator (this author included) can add their own forbidden
names - their own trademark risks to guard against, not only this project's - via a local file
(`COUNCIL_FORBIDDEN_NAMES_FILE`) that is hashed at load time and never committed; see
`src/name-lint.js`'s own comments for why a hash, not a plain list, is what a public repo can
safely carry. `.gitignore` covers a `.council/` directory as the suggested place to put this file
and your own `COUNCIL_PERSONAS_FILE` - that's a convention, not an enforced one: the environment
variable accepts any path, and only the `.council/` directory specifically is protected from an
accidental `git add`.

## The seat names of `plan-the-high-council`

`plan-the-high-council` switches `seat_personas` on, in the form `voice`, and gives each of its fifteen proposer and judge seats a `persona` name. These are not the five above, and the names are not chosen for being free of anyone's rights: they are real people and figures of faith, and some of them are alive.

- Living people: Angela Merkel and Andrej Karpathy.
- A novelist: Frank Herbert.
- Figures of scripture and tradition: Noah, Abraham, Moses, Melchizedek, Matthew and Husayn ibn Ali.
- Historical figures: Van Gogh, Aristotle, Einstein, da Vinci, Archimedes and Plato.

Under the form `title`, which six of the seven shipped planning chains use, a name is only the title of a seat: the seat's prompt says the name changes nothing the seat does. Under the experimental form `voice`, which `plan-the-high-council` uses, a seat also gets a few plain sentences about the person's spirit and acts. Those sentences were settled with the maintainer and written from general knowledge; at the release review their reported speech, their counts and superlatives and what they say of who did something first or why were checked against sources, and what no source carried was cut or corrected, or kept on the maintainer's word. They carry no quotation marks. For the two living people they use the public record only and say nothing about inner life beyond what the person has said in public. The Merkel sentence gives in English her words "Wir schaffen das", said at her summer press conference at the Bundespressekonferenz on 31 August 2015 (the federal government's transcript of that press conference has them). No setting gives one name less than another.

To use a form for one run without editing the chain file, give `--persona-form title` or `--persona-form voice` on the `council` command (the MCP tools `start_run` and `dry_run` take `persona_form`). It works on a chain that already switches `seat_personas` on, and a run keeps its form when it is resumed.

Nobody named here has seen, approved or taken part in this project. A name is a title, not a claim that the person agrees with a plan or that a model speaks as they would.

If the top layer of a layered chain holds one seat that carries Melchizedek or Karpathy, `council doctor` and the run's pre-flight list warn that the other name is unused; the run still starts.

## Two carriers: debating seats and judges

A persona reaches a prompt by one of two routes, and a seat never uses both. A debating seat (`seats.proposers`) takes `role.persona`: a name resolved against this set, with its voice, used in the debate stage only; or the field `persona`, a plain name that is only a title. A judge (`seats.critics`) takes only the field `persona`, together with the chain switch `seat_personas`: a plain name that is never looked up in this set, written into the judge's own system prompts (see AI-README, `persona`). The chain's form is `title` or `voice` for everyone: under `title` every named seat is told its name is the title of its seat and changes nothing it does, and a `role.persona` voice on any proposer is refused (with the switch on it is refused under `voice` too, since the voice then comes from `persona`; the route exists only with the switch off). The judge route never uses the voices on this page.
