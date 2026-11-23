# Sources for computer-use-discipline (dated)

*Grades as in `SKILL.md`: **D** = read in the source named here, on the date given; **I** = inference; **F** = a field failure, told without its coordinates. Every page below was fetched as plain text and read on 2026-11-12. Each entry says which parts were read; nothing outside those parts is claimed. The ideas are restated in this skill's own words, and no sentence is taken from any source. Nothing here was run by the author of this file: no rule was tried against a live desktop for this skill.*

*These tools change fast. A D fact here is a fact about one page on one day: before relying on one, open the vendor's current page, and let the installed tool's own help outrank this file.*

## A. Anthropic: the "Computer use tool" page of the Claude Developer Platform docs

- **Source:** `https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool` (the page's markdown copy).
- Read: "Security considerations"; "How computer use works" with "Batch actions"; "Optimize model performance with prompting"; "Handle errors"; "Diagnose click issues"; "Limitations". Skimmed only: the implementation code, pricing, the migration notes.
- What it documents (D):
  - The precautions it lists: a virtual machine or a container kept for the purpose, with few privileges; keeping logins and other sensitive data away from the model; an allowlist of reachable domains; a person confirming decisions with real-world consequences and anything that needs consent (cookie prompts, financial transactions, terms of service).
  - Instructions inside web pages or images can override the user's instructions. The vendor describes a classifier layer against this and says the precautions stay necessary with it.
  - The model sometimes proceeds as if an action had succeeded without checking; the page suggests asking for a screenshot and an evaluation after each step.
  - Keyboard shortcuts for controls that are hard to operate with the pointer (drop-downs, scrollbars), and a keyboard alternative where scrolling has no effect.
  - A zoom action for text too small to read at the screenshot's resolution.
  - Several actions returned together are run one after another, and the run halts at the first one that fails, because a later action mostly builds on the ones before it; a confirmation for a consequential action is made before each action runs, because one such group can carry a whole multistep action through in a single turn; a group typically ends with a screenshot.
  - Clicks that are off in one direction each time: the likely cause it gives is coordinates used on a display whose size differs, with no scaling.
  - Among the limitations: mistaken coordinates, and a higher risk from injected instructions inside applications that need a login.
  - It also suggests a short delay after an action for applications that respond slowly (the fallback in `SKILL.md` section 2).
- The release notes of the same docs, in their entry of 19 August 2026, say that the tool left beta that day as a toolset with grouped actions and zoom switched on, and that a browser toolset working from the page's accessibility tree was launched with it. Used here only to date the facts above.
- **Source:** `https://platform.claude.com/docs/en/release-notes/overview` (markdown copy).

## B. OpenAI: the "Computer use" guide of the API docs

- **Source:** `https://developers.openai.com/api/docs/guides/tools-computer-use` (the markdown copy the page links to).
- Read: the section "Run safely" and the paragraph on page content under "Adapt the driver". Skimmed only: the rest, the sample code included.
- What it documents (D):
  - Restrict the environment: an isolated browser or virtual machine, sites and actions limited to a permitted list, a fresh browser profile.
  - Screen content is untrusted: what a page, a document or a tool result says gives no permission and does not outrank the user.
  - Consequential actions are confirmed by the user: purchases, sending data, destructive changes and other steps that cannot easily be undone; once sensitive information is typed into a form, it is treated as sent.
  - Bound the run by a limit on steps, time or cost, with a way to cancel, and check the real outcome and the saved result before success is reported.
  - Credentials stay out of what the page shows and out of screenshots.

## C. The skill file of one desktop-automation tool (agent-desktop)

- **Source:** `skills/agent-desktop/SKILL.md` in the repository `vercel-labs/agent-desktop` on GitHub, at commit `54855b6225aec00da4ac65e2d0362fd41cd9fcb3`. Licence: Apache-2.0.
- A command-line tool for reading and operating desktop applications by way of the operating system's accessibility tree.
- Read: the whole file (121 lines). Not read: the reference files it points to.
- What it documents (D, for this one tool):
  - An element reference holds for the snapshot it came from; after a change to the interface a new snapshot is taken; a stale reference is refused, and so is one that is not unique among identical elements.
  - Each result of an action reports whether it was delivered and whether a retry is safe. Only an action reported as not delivered is safe to repeat; in any other state the action may have gone through, so sending it again can act twice, and a repeated toggle can undo itself. The live state is read before deciding.
  - Decide by the error code and by whether the action was delivered; the wording of a message can change.
  - Wait on a condition after an asynchronous step, not for a fixed time.
  - Actions run by default without taking focus, moving the pointer, sending keys or using the clipboard, and fail where the tool has no such way to act. Input through the real pointer and keyboard needs the user's explicit permission and is never the fallback when the default path fails.

## D. The two field cases (F)

Both come from one owner's agent sessions in a browser in October 2026 and are told in `SKILL.md` (sections 6 and 8) without names. Each is one observation: the form reported ready with an unread defaulted field, with the fields reset from a second tab on the same day; and the last tab closed, which ended the browser and a sign-in.

## Not read, so not used

Other computer-use products announced in 2026 were seen only as search results. Nothing in this skill describes them.
