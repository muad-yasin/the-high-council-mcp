// v5 §1 candidate 3: does every withdrawn proposal actually resolve to a
// surviving owner? A lab can withdraw "in favour of" another proposal
// (`replaced_by`); if two or more withdrawals point around in a circle, or
// a chain of withdrawals dead-ends without ever reaching a proposal that
// is still standing, the section that chain was covering has nobody left
// to write it - a real run's own debate hit exactly this (KIMI-4 and
// MISTRAL-2 mutually withdrew in each other's favour) and it went
// undetected. Pure function over `report.proposals` - no ledger file, no
// state beyond what a run already records.
export function withdrawalLedger(proposals) {
  const byId = new Map((proposals || []).map(p => [p.id, p]));
  const orphanSections = new Set();
  const cycleSignatures = new Set();

  for (const p of proposals || []) {
    if (!p.withdrawn) continue;
    const path = [];
    let cur = p.id;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const idx = path.indexOf(cur);
      if (idx !== -1) {
        const cycle = path.slice(idx);
        cycle.forEach(id => orphanSections.add(id));
        cycleSignatures.add([...cycle].sort().join(','));
        break;
      }
      path.push(cur);
      const node = byId.get(cur);
      if (!node) { // dangling replaced_by reference: the chain so far has no surviving owner
        path.forEach(id => orphanSections.add(id));
        break;
      }
      if (!node.withdrawn) break; // resolved to a proposal that is still standing - not orphaned
      if (!node.replaced_by) { // withdrawn with nothing named in its place - a dead end
        path.forEach(id => orphanSections.add(id));
        break;
      }
      cur = node.replaced_by;
    }
  }

  return {
    orphanSections: [...orphanSections].sort(),
    withdrawalCycles: cycleSignatures.size,
  };
}
