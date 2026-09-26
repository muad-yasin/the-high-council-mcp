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

## Before any code: first-run problems

These have no code of their own. Each is something a first-time user hit when the path was
walked from zero (2026-09-25).

### `council: command not found`

`council` is only a command after `npm install -g the-high-council`. With `npx`, type
`npx the-high-council` wherever the docs say `council` (for example
`npx the-high-council doctor`). The CLI's own hints use the `npx` form when you started it
with `npx`.

### `HTTP 401` - the key was not accepted

The provider rejected the key in the named variable (for example `OPENROUTER_API_KEY`). Check
that it was copied whole, with no quotes or spaces around it, that it is still active on the
provider's site, and that it belongs to that provider (an OpenAI key does not work as an
OpenRouter key). Fix `.env`, then `council --resume runs/<id>`.

### `HTTP 402` - no credit

The provider would not bill the call: the account has no credit or reached its own spend limit.
A new account usually needs credit added before paid models answer. Add it on the provider's
site, then resume. Completed stages replay for free.

### `HTTP 403` - refused

A disabled key, a model your account is not allowed to use, or a block on the provider's side.
Check the key and the model name on the provider's site.

### `nothing is listening at http://localhost:11434`

A seat uses `ollama` and no Ollama server is running. Start Ollama (the app, or `ollama serve`),
pull every model the chain names (`ollama pull llama3.1`), then resume. `council doctor` lists
local chains as runnable because they need no key, not because the server is up.

### A run stopped with `STOPPED: per-run spend cap reached` (exit 4)

The next stage's worst case would have crossed the cap. Nothing past the cap was spent, and no
plan was written yet; what the run got through is in `report-partial.json` and `BOARD-partial.md`.
`council --resume runs/<id> --max-usd <higher>` continues from where it stopped. The run tells you
at the start when a chain's worst case is above your cap. `plan-premium-7` and `plan-highest-7`
are above the default $7 cap before they start: price them with `--dry-run` and pass a
`--max-usd` at or above that.

### `BLOCKED: ... file(s) named but never fenced` (exit 9)

The task names a file (`src/app.js`, `package.json`) but does not include its content, so the
seats would plan against code they never saw. Nothing was called. Either append the real files
with `council fence --task tasks/x.md --repo <path> <file> ...` and read the task file before
running, or, if the names are only locations, run with `--allow-unfenced` (whole task) or
`--allow-unfenced a.js,b.ts` (those files). `BLOCKED-ARTIFACTS.md` in the run folder lists the
names it found.

### `--chain` refused, or a chain lint error naming `key-host`

`--chain` takes a chain's name (`cheap-7-v2`, or `my-chain` for your own `chains/my-chain.json`),
never a path; anything else is a usage error (exit 2). `key-host` means a seat with a keyed
provider has a `baseUrl` that is not that provider's own https API, and its key would go there.
Move a local or self-hosted server to an `ollama` seat, or, for a local proxy in front of the
provider, set `COUNCIL_ALLOW_LOOPBACK_KEY_HOST=1` (loopback addresses only).

### `.env holds your API keys and git would commit it`

`council doctor` found a `.env` in a git repository that `.gitignore` does not cover. Add a line
`.env` to `.gitignore` before the next commit. If a key was ever committed or pushed, revoke it on
the provider's site and make a new one: deleting the file later does not remove it from history.
