# Contributing

The most useful help right now: tell us what your runs cost.

## Send a run cost

After a paid run, type `council --spend --days 30` in your project folder. Then
[open an issue](https://github.com/muad-yasin/the-high-council-mcp/issues/new) titled "Run cost: <chain>" with
that run's line, your version (`council --version`) and roughly how long your task was. Never paste your task,
your plan or a folder path. Your figure goes into the README's [Pricing](README.md#pricing) table.

## Code

Bug, docs and typo fixes are always welcome. For anything bigger, open an issue first. Quickest to review: a
provider adapter, a chain config, a mock fixture or a skill change. `npm test` runs offline for $0 and checks
the project's rules (no Grok, reasoning never lowered, prompt wording only in `src/roles.js`).

Two things are settled: bring-your-own-key only, and no claim about output quality until it is measured.

Security issues: [contact@sower-industries.de](mailto:contact@sower-industries.de).
