# Unreal: NOT YET VERIFIED

*This file is a stub. Nothing in `game-verification` was checked on Unreal; do not treat the ladder's engine-specific advice as proven here.*

What the documentation says (Unreal Engine 5.8, Gauntlet automation framework overview, read 2026-10-04): Gauntlet is a framework that runs sessions of an Unreal project to perform tests and validate results; the page calls its test controller well suited to smoke tests that take several steps. It is documented as launching a cooked build, driving it and parsing its logs and crashes, which is the shape of the smoke gate in `SKILL.md` section 2.

Questions to answer before relying on it:

1. How does the test runner report results, and does an exit code agree with them on a deliberately crashed run?
2. What can a cooked or dedicated-server run execute with no display, and what needs a rendering mode?
3. How is a capture triggered from a script, and from which camera?
4. Can input be injected through the real bindings, or recorded and replayed?
5. How do you assert that a feature's expected signal fired?
