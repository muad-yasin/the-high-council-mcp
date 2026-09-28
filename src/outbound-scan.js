// 0.7.9 (owner decision via C&C, 2026-09-28): the outbound key scan, on by default. A key pasted
// into a task, a --context document or a handed draft used to reach every seat, and so every lab
// behind them - the credential shapes in src/secret-patterns.js were checked only under an opt-in
// `--pii-gate`. Now every prompt is scanned before it leaves: in invoke() for every provider call
// and every external seat's NEEDS file (chain.js), and once up front over the input files so the
// refusal can name the file and line (cli.js).
//
// Credential shapes only. PII (emails, IBANs, cards) stays behind the opt-in `--pii-gate`. The
// scan reads and never rewrites: a clean prompt goes out byte-identical. A match is reported by
// pattern name, where and which line - never the value. The two context-only shapes (a bare
// 32-char / 64-hex string when the text says "mistral" / "together") are left out, the same way
// redaction leaves them out: "together" is an ordinary English word and a SHA-256 is not a key.
// A key written as plain prose ("the password is hunter2") has no shape and is not detectable.
//
// The one override is `--allow-secret-shaped` (saved in run.json, so a resume keeps it; MCP
// start_run `allow_secret_shaped`).

import { findSecrets } from './secret-patterns.js';

// [{ line, name }] for every credential-shaped span in `text`, 1-based lines.
export function secretShapesIn(text) {
  if (typeof text !== 'string' || !text) return [];
  return findSecrets(text, { redactable: true }).map(s => ({
    line: text.slice(0, s.start).split('\n').length,
    name: s.name,
  }));
}

// A prompt was about to go out with a credential shape in it. Control flow like BudgetExceeded:
// no catch may turn it into an abstention (rethrowControlFlow reads `controlFlow`).
export class SecretShapedPrompt extends Error {
  constructor(label, findings) {
    super(`stage "${label}": the prompt contains ${findings.length} credential-shaped string(s) (${[...new Set(findings.map(f => f.name))].join(', ')}); nothing was sent`);
    this.controlFlow = true;
    this.label = label;
    this.findings = findings; // [{ part: 'system'|'user', line, name }]
  }
}

// Throws SecretShapedPrompt unless the prompt is clean or the scan is waived.
export function assertOutboundClean(label, { system, user }, { allow = false } = {}) {
  if (allow) return;
  const findings = [
    ...secretShapesIn(system).map(f => ({ part: 'system', ...f })),
    ...secretShapesIn(user).map(f => ({ part: 'user', ...f })),
  ];
  if (findings.length) throw new SecretShapedPrompt(label, findings);
}
