// ROADMAP 37 (0.8.3, M0 work item 2, owner 8 Oct 2026): the CLI refuses an option it does not know.
// Why: `--dry` is not a flag, so `council --dry --task x.md --chain y` ignored it and started a REAL paid run (found 8 Oct 2026, VERIFIED A27).
// Pure and $0: src/cli.js passes in its own two lists (VALUE_FLAGS beside BOOLEAN_FLAGS) and the argv it has already expanded, and exits 2 with the line this returns.

// Damerau-Levenshtein, optimal string alignment (a transposition costs 1), for short flag names.
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * The known option a mistyped name most likely meant, or null.
 * A known name that STARTS WITH what was typed wins (shortest first): `dry` -> `dry-run`. Plain edit distance would pick `days` for it
 * (distance 2 against `dry-run`'s 4). Otherwise the nearest by edit distance, within a third of the typed length (at least 1, at most 3); ties go to the alphabetically first.
 */
export function closestFlag(name, known) {
  const typed = String(name).toLowerCase();
  const names = [...known].sort();
  const prefixed = names.filter(k => typed.length > 0 && k.startsWith(typed) && k !== typed).sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  if (prefixed.length) return prefixed[0];
  const limit = Math.min(3, Math.max(1, Math.floor(typed.length / 3)));
  let best = null, bestD = Infinity;
  for (const k of names) { const dist = distance(typed, k); if (dist < bestD) { best = k; bestD = dist; } }
  return bestD <= limit ? best : null;
}

// 13 Oct 2026 (T1-1): a dash-typed option. `---dry-run`, `—dry-run` (a pasted em dash), `--max‑usd` (a non-breaking hyphen inside the name), `--dry-run,` and a zero-width space before `--` matched neither pattern below, fell through, and the
// command then looked for the exact string (`argv.includes('--dry-run')`) and found nothing: the option was dropped and a paid run started. Now ANY token that is not consumed as a value, whose first character after the invisible ones is a hyphen or a
// dash-like one, and that neither pattern accepted, is refused as unknown. "Dash-like" and "invisible" are defined once, by DASH_CLASS and LEAD below (the older partial list that stood here went stale). A bare word with no hyphen at all is
// not an option-shaped token: findStrayPositional refuses it on the main path.
// T1-1 fix-up (13 Oct 2026): a no-break space (U+00A0, category Z) before `--dry-run` skipped the check (only the format characters were stripped) and the option was dropped. THE RULE that makes a character dash-like is one pattern, DASH_CLASS:
// every character of category Pd (dash punctuation) PLUS these listed ones that read as a hyphen or a minus but are not Pd: U+2212 minus sign, U+2043 hyphen bullet, U+02D7 modifier letter minus, U+207B superscript minus, U+208B subscript minus,
// U+2796 heavy minus sign, U+10D8F Garay minus sign. Skipped before the test, and named in the refusal: format characters (Cf) and spaces (Z). Both are used everywhere below, so no second copy of the set can drift.
const DASH_CLASS = '\\p{Pd}\\u2212\\u2043\\u02D7\\u207B\\u208B\\u2796\\u{10D8F}';
const INVISIBLE = /\p{Cf}/u;
const LEAD = /^[\p{Cf}\p{Z}]+/u;
const DASHLIKE = new RegExp(`[${DASH_CLASS}]`, 'u');
const STARTS_DASH = new RegExp(`^[-${DASH_CLASS}]`, 'u');
// A lone `-` and a bare negative number (`-1`, `-0.5`) are no option (test/cli-unknown-flag.test.js has pinned the number since 0.8.3 M0).
const startsLikeOption = token => { const t = token.replace(LEAD, ''); return t !== '-' && !/^-\d[\d.]*$/.test(t) && STARTS_DASH.test(t); };
/** The first character of `token` that is a look-alike hyphen or invisible (not a plain `-`), as { code: 'U+2014', invisible }, or null. */
function oddCharOf(token) {
  for (const ch of token) {
    if (ch !== '-' && DASHLIKE.test(ch)) return { code: `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`, invisible: false };
    if (INVISIBLE.test(ch)) return { code: `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`, invisible: true };
    if (/\p{Z}/u.test(ch)) return { code: `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`, invisible: true, space: true };
  }
  return null;
}
/**
 * The option name a token spells with its look-alikes folded to plain hyphens, or null when it spells no option name at all (it has whitespace, or something other than letters, digits, `_` and `-` inside the name): the invisible characters
 * and every dash-like one folded away, the leading run of hyphens cut, the `=value` tail cut, trailing punctuation cut (`--dry-run,`). `-notes.md` and `—x is why` are no option name.
 */
function foldedName(token) {
  const t = token.replace(LEAD, '').replace(/\p{Cf}/gu, '').replace(new RegExp(DASHLIKE.source, 'gu'), '-');
  if (/\s/.test(t)) return null;
  const m = /^-+([A-Za-z][A-Za-z0-9_-]*)(?:=.*)?$/.exec(t.replace(/[^A-Za-z0-9_-]+$/, ''));
  return m ? m[1] : null;
}

// The one rule for "a value flag takes the token after it" (src/cli.js flag() reads the same way): unless that token itself starts with `--` or, T1-1, spells a KNOWN option once its look-alikes are folded. findUnknownFlag and
// findStrayPositional both use it, so what one treats as a value the other does too.
const consumesNext = (next, known) => next !== undefined && !next.startsWith('--') && !(foldedName(next) !== null && known(foldedName(next)) && (startsLikeOption(next) || LEAD.test(next)));

/**
 * The first token of `args` that looks like an option and is not one, as { token, name, suggestion, odd }, or null. Shapes that look like an option: `--name` (on neither list), `-name`, a single dash and a letter (the CLI has no single-dash option:
 * `-dry-run` is `--dry-run` mistyped, and `-x` is ignored by nothing), and (T1-1) anything else that starts with a hyphen or a dash-like character after the invisible ones: `---name`, `—name`, `--max‑usd`, `--dry-run,`, `—name=value`. `odd` is the first
 * look-alike hyphen or invisible character in the token ({ code, invisible }), null when the token is plain ASCII. Exceptions: `-v` as the FIRST argument, the version (src/cli.js reads it as argv[0]), a lone `-`, and a bare negative number. A name typed after one dash is
 * looked up as if it had two, so `-dry-run` suggests `--dry-run`.
 * A value flag consumes the token after it unless that token itself starts with `--` (the same rule as flag() in src/cli.js) or, T1-1, spells a KNOWN option once its look-alikes are folded (`--label —dry-run`: the em-dash option is not a label), so a value is
 * never mistaken for an option, whatever else it starts with (`--max-usd -1`, `--task -notes.md`, `--label -x`). `--name=value` has already been expanded or refused by src/cli.js before this runs.
 */
export function findUnknownFlag(args, valueFlags, boolFlags) {
  const known = n => valueFlags.has(n) || boolFlags.has(n);
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (i === 0 && token === '-v') continue;
    const single = /^-([A-Za-z][A-Za-z0-9_-]*)$/.exec(token);
    if (single) return { token, name: single[1], suggestion: closestFlag(single[1], [...valueFlags, ...boolFlags]), odd: null };
    const m = /^--([A-Za-z][A-Za-z0-9_-]*)$/.exec(token);
    if (!m) {
      if (!startsLikeOption(token)) continue;
      const folded = foldedName(token);
      return { token, name: folded, suggestion: folded ? closestFlag(folded, [...valueFlags, ...boolFlags]) : null, odd: oddCharOf(token) };
    }
    const name = m[1];
    if (valueFlags.has(name)) {
      if (consumesNext(args[i + 1], known)) i++;
      continue;
    }
    if (boolFlags.has(name)) continue;
    return { token, name, suggestion: closestFlag(name, [...valueFlags, ...boolFlags]), odd: null };
  }
  return null;
}

/**
 * The first token of `args` that is neither an option nor the value of one, as { token }, or null (T1-1 positional rule, 14 Oct 2026). Call it ONLY on the main path, after every subcommand block has had its turn: the CLI has no bare-word form
 * there (subcommands are dispatched on argv[0] and exit; a task is `--task <file>`), so a bare word is a typo that would be IGNORED, and an ignored word that was meant as an option (`dry-run` with no hyphens, `ーdry-run`, `一dry-run`) lets a paid run start.
 * No list of look-alike glyphs can close that; refusing every unconsumed word does. Values are consumed by the same rule as findUnknownFlag (consumesNext). `-v` as the first argument and options are not stray; a lone `-` or a negative number
 * that is not a value IS (nothing reads one). It is the LAST refusal before money moves: src/cli.js (`refuseStray`) calls it at the end of each block's own refusals, so a more specific sentence (a removed flag, a missing run folder) is never hidden behind it.
 */
export function findStrayPositional(args, valueFlags, boolFlags) {
  const known = n => valueFlags.has(n) || boolFlags.has(n);
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (i === 0 && token === '-v') continue;
    const m = /^--([A-Za-z][A-Za-z0-9_-]*)$/.exec(token);
    if (!m) return { token };
    if (valueFlags.has(m[1]) && consumesNext(args[i + 1], known)) i++;
  }
  return null;
}

/** The one line the CLI prints (stderr) before it exits 2 for a stray word. */
export function strayPositionalLine({ token }) {
  return `${token}: not a command, and not the value of any option, so it would be ignored. Options start with --. Nothing was run and nothing was spent.`;
}

/** The one line the CLI prints (stderr) before it exits 2. A token that holds a look-alike hyphen or an invisible character says which one, by code point: the plain-looking spelling is not the plain spelling. */
export function unknownFlagLine({ token, suggestion, odd = null }) {
  const why = odd ? (odd.space ? `this contains ${odd.code}, a space that is not part of an option` : odd.invisible ? `this contains ${odd.code}, an invisible character that is not part of an option` : `this contains ${odd.code}, not the plain hyphen the options use`) : 'not an option of this command';
  return `${token}: ${why}${suggestion ? ` - did you mean --${suggestion}?` : '.'} Nothing was run and nothing was spent.`;
}
