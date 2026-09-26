# Field lessons - design-level defects from shipped work

Real failures, generalized: the context is gone, the shape recurs. Read when reviewing shipped UI or when a defect "feels familiar."

Implementation-level lessons - text overflow and truncation, transient messages overwritten by timed refreshes, stale viewport and safe-area measurements, lifecycle handlers that fire twice, literal mockup import - are owned by `frontend-developer` and its references. They are not repeated here.

## Numbers and units on screen

- **A displayed rate's time unit must match the product's real cadence, not the civil calendar.** Two screens each converted the same per-second value to "/day" and "/hr" with 24-hour arithmetic, while the product's internal day was much shorter and the value was only earned during part of it. The two displays disagreed by exactly 24/14 (1.714x) - the payout logic agreed with itself to the last unit; the *display* picked a basis nobody had checked. Whenever a display converts a rate to a bigger unit, check the unit against the real operating cadence.
- **The same stat on two screens with two derivations is worse than either being wrong.** One screen zeroed a value during an inactive state; a sibling read the raw value. Users moving between them saw reality contradict itself. When it recurred inside the same screen, twelve lines below the comment explaining the first fix, the deeper lesson surfaced: **a rule found by fixing one instance must be swept from its whole category**, with a mechanical check - a comment is a promise, not an enforcement.

## States that erase information

- **A disabled control can make an explanation unreachable.** If the only route to a rejection reason is a tap the disabled state already blocks, that reason can never be shown. Fine if the state is truly unreachable; silent information loss if another path can still hit the same rejection. Check which.
- **Disabling a whole surface to "lock" it reads as breakage.** A feed that picked up the shared disabled tint during a busy state was reported as "it turned grey." Keeping it live and letting existing navigation rules resolve the conflict needed no new design.

## Contrast recurrence

- **A selected-state fill can equal the text color on top of it - 1:1 contrast - and ship unnoticed for a long time** when the state is visited rarely or the surrounding chrome distracts. A computed contrast check on a rendered capture finds it immediately; a walkthrough misses it. Treat every new state-color pairing as a mechanical contrast check, not a one-time audit.
