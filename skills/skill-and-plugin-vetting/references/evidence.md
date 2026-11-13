# Evidence for skill-and-plugin-vetting (dated)

*Grades as in `SKILL.md`. Every source below was fetched as plain text and read on 2026-11-12; each entry says how much of it was read. Ideas are restated in this skill's own words. Nothing here was tried by the author of this file: no skill was attacked or scanned for it.*

## A security firm's test of skill scanners (D)

- **Source:** "The sorry state of skill distribution", The Trail of Bits Blog, 3 June 2026, two named authors. Read: the whole post as page text. Not read: the companion repository with the test skills.
- **What it reports:** the firm wrote four openly harmful test skills. Between them they passed the scanner of one public skill marketplace, the three scanners built into another, and one vendor's open-source scanner.
  - One put its payload after 100,000 newlines; a scanner cut the file short and never reached it.
  - One told the agent to take its real instructions from an office document, which is a ZIP archive, and shipped a script inside that archive.
  - One carried Python source that was harmless beside precompiled bytecode that did something else; neither the static checks nor the model pass of the scanner opened the bytecode.
  - One changed the package registry and described the change, in the skill's own comments, as ordinary company configuration; a scanner run with a model the post calls relatively strong gave the finding a low rating and called the skill safe.
  - By the authors' account, three of the four were devised and built in less than an hour, and the fourth in a few hours.
  - The static part of one scanner ignored hidden files, looked only at files the main skill file referenced, and treated binaries and images as opaque.
- **What it concludes:** scanning and model analysis cannot be relied on to find harmful content in skills; a scanner that stands still lets an attacker try again and again; curated sets with control over who may add or update a skill are the alternative, together with pinned versions and a human judgment that is not handed to a tool.
- **How far it reaches:** named scanners, on the days the firm tested them, against skills the firm wrote. It gives no rates. The curated set the post recommends is one the firm maintains itself.

## One vendor's documentation (D)

- **Source:** Claude Developer Platform documentation, page "Agent Skills" (overview), section "Security considerations" (markdown copy; that section only).
- **What it says:** use only skills from a trusted source, and the page names two such sources: yourself, for skills you made, and this vendor; if a skill from another source must be used, the page asks for extreme caution and a thorough audit first, of every bundled file, looking for network calls, file access and operations that do not match the stated purpose; a skill that fetches from outside can receive instructions that way, and a skill that was sound can be compromised when what it depends on changes; treat a skill like installed software. It also says the vendor's own content scanning covers some upload routes and not others.
- **How far it reaches:** one vendor's advice for its own products on that day.

## A skill that pre-approves its own tools

- **Source:** Claude Code documentation, page "Skills": the first two paragraphs of the section "Pre-approve tools for a skill" and the list item "Skill folder as a plugin" (read 2026-11-12, those parts only; the section's example and its paragraph on `disallowed-tools` were not read).
- **What it says:** a skill's `allowed-tools` field lets the listed tools run without a prompt for the turn in which the skill is invoked, the workspace trust setting does not gate that field, and the page advises reviewing that field in any skill a repository carries before running there. The list item says a skill folder can be loaded as a plugin that brings its own hooks, agents and MCP servers, which inside a project first needs the workspace trust dialog accepted.
- **How far it reaches:** one vendor's documented behaviour on that day. Other harnesses differ, and this one may change.

## The open format's client guide (D)

- **Source:** agentskills.io, "How to add skills support to your agent" (markdown copy), the paragraph on skills that come from the project being worked on. That paragraph only.
- **What it says:** such skills may come from a repository nobody has checked, for instance one just cloned, so a client should consider loading them only for a folder its user flagged as trusted; otherwise the repository can place instructions in front of the agent unasked.
- **How far it reaches:** advice to authors of agent clients. Whether a given client follows it has to be read in that client's own documentation.

## Two issues in one scanner's tracker (D)

- **Source:** the issue tracker of NVIDIA/SkillSpector on GitHub, issues 356 (opened 2026-08-09, closed 2026-08-12) and 303 (opened 2026-07-23, closed 2026-09-21), read through GitHub's interface for programs: each title and the start of each report.
- **What they say:** 356: the folder that holds compiled Python files was among the paths the scanner skipped, so a skill with clean source and harmful bytecode was scored safe with no findings (reported against one release). 303: on a provider that limits request rates, batches that were refused were dropped without a retry, and the scan still printed a complete risk assessment.
- **How far it reaches:** two reports by users, about one scanner at the versions they name. Both are closed; whether and how they were fixed was not read.

## Two papers (abstracts read, through arXiv's interface for programs)

Each figure belongs to its setup. Neither paper measured your agent or your harness.

- **Source:** "Agent Skills Enable a New Class of Realistic and Trivially Simple Prompt Injections" (arXiv:2510.26328v1, 30 October 2025). A preprint; its record names no journal or conference.
  - The authors hide harmful instructions in long skill files and in referenced scripts and use them to send out internal files and passwords. They also show, for one widely used coding agent, a narrow approval given with a "don't ask again" option carrying over to closely related harmful actions. The abstract gives no rates.
- **Source:** "'Do Not Mention This to the User': Detecting and Understanding Malicious Agent Skills in the Wild" (arXiv:2602.06547v4, 10 June 2026). Its arXiv record says it was accepted at the 35th USENIX Security Symposium.
  - 98,380 skills from two registries, examined by pattern matching followed by behavioural verification: 157 confirmed as malicious, with 632 vulnerabilities across 13 techniques. Two strategies dominate and seldom mix: stealing credentials through remote code, and steering the agent through instructions placed in the skill's documentation. Over half of the confirmed cases come from one actor who imitated known brands from a template. The most advanced skills all used capabilities their documentation did not state. The registries removed all 157 after the authors reported them.

## Read, but nothing here rests on it

- **Source:** "Agent Skills in the Wild: An Empirical Study of Security Vulnerabilities at Scale" (arXiv:2601.10338v1).
  - Its abstract was read. Its prevalence figures come from the authors' own scanning pipeline, and section 4 of `SKILL.md` is about what such pipelines miss, so none of them is used.
