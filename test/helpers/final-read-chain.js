// Shared by test/final-read-stage.test.js and Review/084/cache/capture-final-read-base.mjs (which runs this same chain on the tree BEFORE unit D to capture the switch-off fixture).
// No import from src/: the capture script supplies runChain from the tree it measures.
export const critic = (model, lab, layer, extra = {}) => ({ provider: 'mock', model, lab, layer, ...extra });
export const chainOf = (critics, extra = {}) => ({
  name: 'final-read-test', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
  ...extra,
});
// A1-style end (CODE-4 route A1): layer 1 is never heard, so layers 2 and 3 are never asked and the run ends not agreed with nobody at layer 3 having read anything.
export const neverHeardChain = (tag, extra = {}) => chainOf([
  critic('mock-unreadable', 'l1a', 1), critic('mock-unreadable', 'l1b', 1), critic('mock-critic-script-o-fr2-' + tag, 'l2a', 2),
  critic('mock-critic-script-o-fr3a-' + tag, 'l3a', 3), critic('mock-unreadable', 'l3b', 3),
], extra);
// What a run leaves that a reader of report.json sees; ms and other clocks are left out.
export const snapshot = r => ({
  passed: r.passed, layers: r.layers, panelVerdicts: r.panelVerdicts, signoff: r.signoff, dispute: r.dispute, deliverable: r.deliverable,
  stages: r.stages.map(s => ({ label: s.label, provider: s.provider, model: s.model, usage: s.usage, usd: s.usd, priced: s.priced, cached: s.cached })),
});
