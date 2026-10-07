# Contract v2 - run run-v2 (amended after lock, v2 from v1)

Written by the harness from a draft. The obligations are words a model drafted; they are the contract only because a person approved this exact text.

Run: run-v2
Task sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
Criteria sha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
Signed text sha256: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
Thin contract record sha256: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd

## Amendment

Version 2 replaces version 1. A person approved an amendment request (ledger line 4): obligation O2 changed; every other obligation is the same as in version 1.
The requester's reason, in its own words:
    The line number is what a person needs to find the cause.

## Obligations

### O1
    The export command writes the file atomically: a crash never leaves a half-written file.

Criterion: C1
Check: node --test test/export.test.js

### O2
    Every error path prints one line naming the file, the line and the reason.

## For the builder

If an obligation looks wrong or impossible, stop. Ask for an amendment (the contract_amend tool, naming the version and the obligation id, with your reason and the words you propose) and do not edit tests or this contract to make an obligation pass.
Only a person decides an amendment, at a terminal (council contract amend --decide). Until then the obligation stands as written.

---
Contract record: contract/v2.json, sha256 1d9cf844770c6d0ffcdd1efba5c95bb1588f78ac14e4e30aed6c88eddb5cf7e7 (amended after lock, v2 from v1).
