# Field lessons - design-level defects from shipped work

Real failures, generalized: the context is gone, the shape recurs. Read when reviewing shipped UI or when a defect "feels familiar."

Implementation-level lessons - text overflow and truncation, transient messages overwritten by timed refreshes, stale viewport and safe-area measurements, lifecycle handlers that fire twice, literal mockup import - are owned by `frontend-developer` and its references. They are not repeated here.

## Numbers and units on screen

- **A displayed rate's time unit must match the product's real cadence, not the civil calendar.** Two screens converted the same per-second value to "/day" and "/hr" with 24-hour arithmetic, while the value was earned only during a 14-hour window of the product's day, so the displays overstated the real rate by 24/14 (1.714x) - the payout logic agreed with itself to the last unit; the *display* picked a basis nobody had checked. (The general form, units and frames at a boundary, is `backend-developer`'s hard rule 18.) Whenever a display converts a rate to a bigger unit, check the unit against the real operating cadence.
- **The same stat on two screens with two derivations is worse than either being wrong.** One screen zeroed a value during an inactive state; a sibling read the raw value. Users moving between them saw reality contradict itself. When it recurred inside the same screen, twelve lines below the comment explaining the first fix, the comment had plainly not worked. The sweep rule that follows (a fix found at one instance is applied to its whole category, with a mechanical check) lives in `frontend-developer`, "Design away the bug class".

## States that erase information

- **A disabled control can make an explanation unreachable.** If the only route to a rejection reason is a tap the disabled state already blocks, that reason can never be shown. Fine if the state is truly unreachable; silent information loss if another path can still hit the same rejection. Check which.
- **Disabling a whole surface to "lock" it reads as breakage.** A feed that picked up the shared disabled tint during a busy state was reported as "it turned grey." Keeping it live and letting existing navigation rules resolve the conflict needed no new design.

## Contrast recurrence

- **A selected-state fill can equal the text color on top of it - 1:1 contrast - and ship unnoticed for a long time** when the state is visited rarely or the surrounding chrome distracts. A computed contrast check on a rendered capture finds it immediately; a walkthrough misses it. Treat every new state-color pairing as a mechanical contrast check, not a one-time audit.
