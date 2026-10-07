# Contract v1 - run run-v1

Written by the harness from a draft. The obligations are words a model drafted; they are the contract only because a person approved this exact text.

Run: run-v1
Task sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
Criteria sha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
Signed text sha256: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
Thin contract record sha256: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd

## Obligations

### O1
    The export command writes the file atomically: a crash never leaves a half-written file.

Criterion: C1
Check: node --test test/export.test.js

### O2
    Every error path prints one line naming the file and the reason.

## For the builder

If an obligation looks wrong or impossible, stop. Ask for an amendment (the contract_amend tool, naming the version and the obligation id, with your reason and the words you propose) and do not edit tests or this contract to make an obligation pass.
Only a person decides an amendment, at a terminal (council contract amend --decide). Until then the obligation stands as written.
