# Verifying frontend work, and reviewing someone else's

## Real verification, not a compile and a glance

- **Click/tap through the real interaction path**, not a direct programmatic invocation of the handler. A test or manual check that calls a click handler function directly bypasses hit-testing entirely, so it structurally cannot catch an element that's visually present but not actually clickable (wrong z-index, an invisible overlay stealing the click, a hit area smaller than the visible element).
- **Give the UI a real frame/paint boundary after any state change before checking the result.** Many rendering systems defer layout or don't run mount lifecycle synchronously - reading a measured size, or asserting on rendered content, immediately after triggering a state change can read stale or zero values even though the change is correct once a real frame has passed.
- **A capture at one canvas/viewport size is not evidence about every real device size.** If the interface is meant to work across a range of screen sizes, verify at more than one - the shape most likely to hide a bug is the exact one a given screenshot happened to be taken at (commonly the shortest, most compact aspect ratio the interface will actually see, where any surplus space is smallest).

## Reviewing someone else's frontend diff

- Does every element bound to real data handle its empty/loading/error state, not just its populated one?
- Is there a leaked subscription - something subscribed to a state change with no matching cleanup on teardown?
- Does any display value get recomputed from raw state inline, rather than read from the same function/call the data layer already exposes?
- Does any user-facing number get formatted or parsed without an explicit, pinned locale?
- Is color the only signal carrying a meaning (status, correctness, warning) anywhere in the diff?
- Is there a container sized for a guessed content length with no truncation, ellipsis, or growth behavior - and has it been checked against the longest real value that will actually appear there, not a placeholder?

## Right level of automated checking

- **Contrast and color-use checks** (automatable against real rendered colors, not just source-code color names) catch the accessibility gap generation is measurably weak at, without needing a human eye on every screen.
- **A real-device or real-browser check, not just a component-level unit test**, is the only reliable way to catch layout bugs that only manifest at real screen dimensions and real font-rendering behavior - a unit test asserting on a component's props is necessary but not sufficient for layout correctness.
- Don't claim either of the above as "in place" for a given project unless it's actually wired into that project's process - describing a check that doesn't run as if it does is its own version of the happy-path bias this file is warning about.
