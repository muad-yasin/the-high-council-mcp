# Checklist: before loading a third-party skill, plugin or repository instruction file

It is code from someone else, and loading it runs it. Read it at the version you will use.

- [ ] Tool grants and permission changes it carries (pre-approved tools, allow rules, settings it edits)
- [ ] Hooks, and anything else that runs on load, at session start or around a tool call
- [ ] Server or connector configuration it ships: what it connects to, and with whose credentials
- [ ] Scripts read in full; a binary, an archive or compiled code without source is unread, so untrusted
- [ ] Network calls: where data goes, and what is sent
- [ ] Wording that asks for secrecy or urgency, or tells the agent to act without asking the user
- [ ] A name one character away from a known skill or publisher
- [ ] Invisible characters, bidirectional overrides, and long blank runs that push text out of view
- [ ] The scan's verdict together with what it skipped; a pass covers only what was scanned
- [ ] Pinned to the version that was read; an update is read again

## With the inventory (`SKILL.md` sections 1 to 3)

- [ ] Every file listed by a tool, hidden files included, not only the files the skill names
- [ ] What the description says the skill does, set against what its scripts and endpoints do
- [ ] An explanation inside the skill of why something unusual is safe: read as part of the thing reviewed
- [ ] Content fetched when the skill runs: declined, or pinned and reviewed
- [ ] Changes to package registries, credential helpers, version-control hooks or shell profiles
- [ ] The review done where no secret is in reach and nothing can be sent out

## The record (`SKILL.md` section 5)

- [ ] The source, the version or hash, and the date
- [ ] The files read, and the files not read
- [ ] Each scan, with what it covered and what it skipped
- [ ] The findings
- [ ] The decision (not loaded, a reduced copy, sandbox only, as it is) and who made it
