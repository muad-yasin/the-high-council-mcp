# Personas

A seat's optional `role.persona` (see `src/seat-role.js`) is a name and voice directive layered
onto a debate-stage prompt - it changes how a seat *talks*, never what it's graded on (see
`src/personas.js`, `src/name-lint.js`). The default set, defined in `src/personas.js`:

- **Moses**
- **Noah**
- **Matthew**
- **Van Gogh**
- **Parzival**

These are historical and religious figures, chosen deliberately because none of them is anyone's
trademark. That said, using any recognizable name as a software judge's voice is itself an
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
directive. `plan-premium-7` seats two such keys, `hypatia` and `avicenna`, next to the five
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
