# Hostile fenced-file corpus

Adversarial file CONTENTS for `test/hostile-fenced-corpus.test.js`. Each file is fenced into a task
the way `council fence` does it, and the test asserts the block stays one closed block and that no
reader of the task's prose (the `label:`, `target_file:` and `signoff:` fields, the fence-header
check, the unfenced-artifact gate, quote validation) takes anything inside it as structure.

Every string here is written for this project. The categories (instructions aimed at reviewers,
forged markers, fence breaking, homoglyphs, bidi, encoded payloads) follow the prompt-injection
page of swisskyrepo/PayloadsAllTheThings (MIT) as an idea only; no text is taken from it.
This README is not a fixture: the test skips it.
