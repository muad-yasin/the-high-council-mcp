// The files of a --from-run folder that the CLI reads to take the earlier run's FIRST draft (src/handoff-from-run.js pickBuildDraft): the draft of the build stage and of its retry, and the stage records that say whether each attempt failed.
// ONE list, two readers: pickBuildDraft opens exactly these (it never opens another name in the folder), and src/mcp/server.js jail-checks exactly these before start_run / resume_run hand the folder to the CLI. A name added here is checked
// there; a name read without being here would be read unchecked (a symlink to a file outside the project). 13 Oct 2026, with the draft-pick unit.
export const BUILD_DRAFT_FILES = ['build-retry.md', 'build.md'];
export const BUILD_RECORD_FILES = BUILD_DRAFT_FILES.map(f => f.replace(/\.md$/, '.usage.json')); // the record failureOf reads for each draft: derived, so a third draft file brings its record along
export const BUILD_READ_SET = [...BUILD_DRAFT_FILES, ...BUILD_RECORD_FILES];
