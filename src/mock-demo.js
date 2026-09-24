// The scripted scenario behind `council demo`. Every `mock-demo-*` seat answers from the script
// below instead of the mock provider's generic placeholder text, so a first-time user sees what a
// real plan run looks like - a concrete request, proposals that disagree, a debate that changes
// them, a panel that splits and then signs off - without a key, a network call or a cent.
//
// It is still the mock provider: every reply is written here, in advance, and no model judges
// anything. Only the chain mechanism around it (anonymising, the board, the ledger, sign-off,
// the handoff) is the real code. The replies key off the real prompts' contents (proposal titles,
// the draft text) rather than off fixed ids, because the chain assigns the anonymised letters.

export const DEMO_REQUEST = `Plan a small command-line tool that renames my holiday photos to the date and time they were taken, like 2024-07-14_153012.jpg.

One folder of about 2,000 JPEGs from two phones, on Linux. I run it myself, once per trip.`;

const CRITERIA = [
  'Every step names the command, file or function it touches.',
  'It says what happens to a photo with no capture date in its metadata.',
  'Nothing the tool does can lose an original photo or its old file name.',
  'It adds nothing the request did not ask for.',
];

// Proposals, keyed by title so the debate and reply stages can find them whatever letter the
// chain gives each lab.
const PROPOSALS = {
  'mock-demo-proposer-a': [
    {
      title: 'Read the capture date from EXIF DateTimeOriginal',
      serves: 'criterion 1',
      what: 'Take the date from the EXIF DateTimeOriginal tag, not from the file system.',
      why: 'It is the moment the shutter fired. Both phones write it; it survives copying.',
      how: 'photodate.py: capture_time(path) reads Pillow Image.getexif(), tag 0x9003, and parses "YYYY:MM:DD HH:MM:SS".',
      acceptance_test: 'capture_time() on tests/fixtures/with_exif.jpg returns 2024-07-14 15:30:12.',
    },
    {
      title: 'Sort renamed photos into one folder per month',
      serves: 'criterion 1',
      what: 'Move each renamed photo into a YYYY-MM/ subfolder.',
      why: 'A 2,000-photo folder is easier to browse by month.',
      how: 'photodate.py: after renaming, os.makedirs(YYYY-MM) and move the file into it.',
      acceptance_test: 'After a run, every photo sits in the folder for its month.',
    },
  ],
  'mock-demo-proposer-b': [
    {
      title: 'Fall back to the file modification time when there is no EXIF date',
      serves: 'criterion 2',
      what: 'If a photo has no DateTimeOriginal, name it from os.stat().st_mtime instead.',
      why: 'Screenshots and edited copies often lose EXIF; every photo still gets a name.',
      how: 'photodate.py: capture_time() returns datetime.fromtimestamp(os.stat(path).st_mtime) when the tag is missing.',
      acceptance_test: 'A photo with EXIF stripped is renamed from its modification time.',
    },
    {
      title: 'Dry run by default, with an undo log',
      serves: 'criterion 3',
      what: 'Print every "old -> new" pair and change nothing unless --apply is given; with --apply, write each rename to a CSV first so --undo can reverse the run.',
      why: 'Renaming 2,000 files is easy to get wrong and tedious to repair by hand.',
      how: 'photodate.py: plan_renames() builds the list; apply() appends old,new to rename-log.csv before each os.rename(); undo() reads it back in reverse.',
      acceptance_test: 'A run without --apply leaves the folder byte-identical; --apply then --undo restores every original name.',
    },
  ],
};

// What each lab says about the other lab's proposals in the debate round.
const POSTS = {
  'Read the capture date from EXIF DateTimeOriginal': {
    stance: 'support',
    text: 'Right tag. Worth noting that DateTimeOriginal has no time zone, so photos from two phones on different zone settings can sort out of order; that is acceptable for this request.',
  },
  'Sort renamed photos into one folder per month': {
    stance: 'object',
    text: 'Not asked for: the request is to rename, not reorganise. It also moves files, which any photo library pointing at the old paths would lose.',
  },
  'Fall back to the file modification time when there is no EXIF date': {
    stance: 'object',
    text: 'Quote: "name it from os.stat().st_mtime". Copying photos off a phone usually resets the modification time to the copy date, so the fallback would give those photos a confident but wrong name. Better to leave them alone and say so.',
  },
  'Dry run by default, with an undo log': {
    stance: 'support',
    text: 'This is what makes criterion 3 checkable. One gap: two photos taken in the same second get the same name, and os.rename() on Linux silently replaces the target.',
  },
};

// Each author's answer to the posts on its own proposals.
const REPLIES = {
  'Read the capture date from EXIF DateTimeOriginal': { action: 'keep', text: 'Agreed on the time zone caveat; the plan states it as an assumption.' },
  'Sort renamed photos into one folder per month': { action: 'withdraw', text: 'Fair. Out of scope, and moving files is a risk the request did not ask us to take.' },
  'Fall back to the file modification time when there is no EXIF date': {
    action: 'amend',
    text: 'The objection is right; a wrong name is worse than the old name.',
    how: 'photodate.py: capture_time() returns None when the tag is missing; those photos keep their names and are listed under "Not renamed (no capture date)" at the end of the run.',
    acceptance_test: 'A photo with EXIF stripped keeps its name and appears in the "Not renamed" list.',
  },
  'Dry run by default, with an undo log': {
    action: 'amend',
    text: 'Good catch on same-second photos.',
    how: 'photodate.py: plan_renames() adds _2, _3 ... when a target name is already planned or already exists; apply() refuses to run if any target exists on disk.',
    acceptance_test: 'Two photos from the same second become 2024-07-14_153012.jpg and 2024-07-14_153012_2.jpg; --apply then --undo restores every original name.',
  },
};

// The tag the chain gives a lab's proposals in the builder's prompt ("## LABA-1 (lab-a) ...").
function ledgerIds(user) {
  const ids = [];
  const re = /^## ([A-Z0-9-]+-\d+) \([a-z0-9-]+\)[^\n]*\n\*\*Title:\*\* (.*)$/gm;
  for (const m of user.matchAll(re)) ids.push({ id: m[1], title: m[2].trim() });
  return ids;
}

function idOf(ids, titleStart) {
  return (ids.find(p => p.title.startsWith(titleStart)) || {}).id || '(no id)';
}

// The plan the builder writes. `revised` adds the fix the panel asked for in round 1: the undo
// log must not be overwritten by a second run.
function plan(user, revised) {
  const ids = ledgerIds(user);
  const exif = idOf(ids, 'Read the capture date');
  const month = idOf(ids, 'Sort renamed photos');
  const fallback = idOf(ids, 'Fall back to the file');
  const dry = idOf(ids, 'Dry run by default');
  const log = revised ? 'rename-log-<YYYYMMDD-HHMMSS>.csv (a new file per run, never overwritten)' : 'rename-log.csv';
  const undo = revised
    ? '`python3 photodate.py DIR --undo rename-log-<stamp>.csv` reads that run\'s log in reverse and renames each file back. It refuses if any old name is taken again.'
    : '`python3 photodate.py DIR --undo` reads rename-log.csv in reverse and renames each file back.';
  const lines = [
    '# photodate - rename holiday photos by capture time',
    '',
    'One Python 3 script, `photodate.py`, plus its tests. Depends only on Pillow.',
    '',
    '## 1. Read the capture time',
    '',
    `\`capture_time(path)\` opens the JPEG with Pillow, reads EXIF tag 0x9003 (DateTimeOriginal) and parses "YYYY:MM:DD HH:MM:SS" (${exif}). If the tag is missing or unparseable it returns None. It never falls back to the file's modification time, because copying photos off a phone resets it (${fallback}, as amended).`,
    '',
    '## 2. Plan the renames',
    '',
    `\`plan_renames(dir)\` lists \`*.jpg\` and \`*.jpeg\` (any case), builds \`YYYY-MM-DD_HHMMSS.jpg\` for each dated photo, and adds \`_2\`, \`_3\` ... when two photos share a second or a target already exists (${dry}, as amended). Photos with no capture time are left out of the plan and listed under "Not renamed (no capture date)".`,
    '',
    '## 3. Dry run by default',
    '',
    `\`python3 photodate.py DIR\` prints every \`old -> new\` pair and the not-renamed list, and changes nothing (${dry}).`,
    '',
    '## 4. Apply, with an undo log',
    '',
    `\`python3 photodate.py DIR --apply\` checks that no target name exists on disk, then for each pair appends \`old,new\` to ${log} in DIR and calls \`os.rename(old, new)\`. The log line is written before the rename, so an interrupted run can still be undone.`,
    '',
    '## 5. Undo',
    '',
    undo,
    '',
    '## 6. Tests',
    '',
    '`tests/test_photodate.py` (pytest), with fixtures for: a photo with EXIF, one without, two photos in the same second, and a folder where a target name already exists. Acceptance: a dry run leaves the folder byte-identical; `--apply` then `--undo` restores every original name.',
    '',
    '## Assumptions',
    '',
    '- DateTimeOriginal has no time zone; both phones are assumed to be set to local time on the trip.',
    '- "Holiday photos" means JPEGs. HEIC and RAW files are listed as not renamed.',
    '',
    '## Scope ledger',
    `${exif} - accepted - section 1`,
    `${month} - withdrawn - by its author after the debate: renaming, not reorganising`,
    `${fallback} - accepted - section 1, as amended: no fallback, undated photos are listed instead`,
    `${dry} - accepted - sections 2 to 5, as amended: same-second suffixes, refuse on existing targets`,
  ];
  return lines.join('\n');
}

function critic(model, user) {
  const draft = user.split('# Draft under review').pop() || '';
  const fixed = draft.includes('never overwritten');
  const met = CRITERIA.map(c => ({ criterion: c, verdict: 'MET', evidence: 'See the draft.' }));
  // Lab B's critic signs off on the first draft; lab A's catches the overwritten undo log. The
  // panel is unanimous only after the revision.
  if (fixed || model === 'mock-demo-critic-b') {
    return { meets: true, criteria: met, failures: [], verdict_line: 'All four criteria are met.' };
  }
  const c3 = CRITERIA[2];
  return {
    meets: false,
    criteria: met.map(r => r.criterion === c3 ? { criterion: c3, verdict: 'FAILED', evidence: 'Section 4: "appends old,new to rename-log.csv in DIR".' } : r),
    failures: [{
      criterion: c3,
      problem: 'Every run writes to the same rename-log.csv, so after a second run (a second trip, or a re-run after adding photos) the log mixes two runs and --undo would rename the first run\'s files back too, or the user deletes the log and loses the old names.',
      fix: 'Write one log file per run, named with the run\'s start time, and have --undo take the log to reverse.',
    }],
    verdict_line: 'One criterion failed: the undo log is shared between runs.',
  };
}

const HANDOFF = `# HANDOFF - photodate

**What:** one Python script that renames JPEGs to their capture time, dry run by default, with a per-run undo log. The plan is PLAN.md.

**Order of work**
1. PLAN.md section 1, \`capture_time()\`, with its two fixtures.
2. Section 2, \`plan_renames()\`, including same-second suffixes.
3. Sections 3 and 4, the dry run and \`--apply\` with the per-run log.
4. Section 5, \`--undo\`.

**After each item:** \`pytest tests/test_photodate.py\` passes, and the item's own test from section 6 is in it.

**Keep current:** PROGRESS.md (what is done), DECISIONS.md (any choice the plan left open), one BUILT-LOG line per commit naming the plan section and proposal ids it serves.

**Never:** add folders, formats or features the plan does not list. Never test against real photos; use the fixtures.

**To start:** "Read HANDOFF.md and PLAN.md, then begin item 1."`;

const SKELETON = `- capture_time(): read the capture date from one photo
- plan_renames(): decide every new name before touching anything
- apply / undo: do the renames, and be able to reverse them
- tests with small fixture photos`;

// Returns a reply for a scripted demo seat, or null to let the generic mock handle the stage.
export function demoReply({ model, system, user }) {
  const reply = text => ({ text, usage: { input: Math.ceil(user.length / 4), output: Math.ceil(text.length / 4) }, provider: 'mock', model });
  if (system.includes('turn a request into acceptance criteria')) return reply(JSON.stringify({ criteria: CRITERIA }));
  if (system.startsWith('You write the skeleton')) return reply(SKELETON);
  if (system.startsWith('You are a proposer')) return reply(JSON.stringify({ proposals: PROPOSALS[model] || [] }));
  if (system.startsWith('You are one lab on a planning panel. Every lab proposed')) {
    const theirs = user.slice(user.indexOf('# The other labs'));
    const posts = [...theirs.matchAll(/^## ([A-Z]-\d+) \(by Lab [A-Z]\)\n\*\*Title:\*\* (.*)$/gm)]
      .filter(m => POSTS[m[2].trim()])
      .map(m => ({ on: m[1], ...POSTS[m[2].trim()] }));
    return reply(JSON.stringify({ posts, revisions: [] }));
  }
  if (system.startsWith('You are one lab on a planning panel, answering')) {
    const replies = [...user.matchAll(/^## ([A-Z]-\d+) \(by Lab [A-Z]\)\n\*\*Title:\*\* (.*)$/gm)]
      .filter(m => REPLIES[m[2].trim()])
      .map(m => ({ id: m[1], ...REPLIES[m[2].trim()] }));
    return reply(JSON.stringify({ replies }));
  }
  if (system.startsWith('You write the handoff file')) return reply(HANDOFF);
  if (system.startsWith('You are an independent critic')) return reply(JSON.stringify(critic(model, user)));
  if (system.startsWith('You are the builder in a multi-model review chain,\nrevising')) return reply(plan(user, true));
  if (system.startsWith('You are the builder in a multi-model review chain.')) return reply(plan(user, false));
  return null;
}
