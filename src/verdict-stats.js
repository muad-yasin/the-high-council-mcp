// Cross-run verdict/quality accounting: how the debate mechanism itself is
// behaving, per chain and per lab. Same convention as spend.js - DERIVED
// from runs/*/report.json and the per-stage *.usage.json files on disk,
// no ledger, nothing transmitted, nothing that survives a deleted run
// folder. Never changes a chain or the debate mechanism; it only reads.
//
// Privacy: chain/lab names, counts, cost and timing only. Never task
// content, proposal text or prompt bodies.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runIdToDate } from './spend.js';
import { shapeRounds } from './shape-rounds.js';

const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

function emptyChainAgg() {
  return {
    runs: 0,
    signedOff: 0,
    roundsToSignoff: [],   // per run that signed off
    objections: 0,
    withdrawals: 0,
    accepted: 0,
    dropouts: 0,
    unparseable: 0,
    costs: [],
    wallMs: [],
    shapeOnlyRounds: 0,
  };
}

function emptyLabAgg() {
  return {
    proposed: 0,
    accepted: 0,
    withdrawn: 0,
    cut: 0,
    dropouts: 0,
    unparseable: 0,
    objections: 0,
    novelObjections: 0,
    signoffs: 0,
    soloSignoffs: 0,
  };
}

// Independence skew: does a lab mostly echo objections other labs already
// raised, and does it sign off even when another lab is still objecting?
// Descriptive only - this never reweights a panel or changes a verdict, it
// only makes a pattern visible that was previously invisible without
// reading every debate post by hand.
function accumulateIndependence(report, byLab) {
  const posts = report.debate?.posts;
  if (Array.isArray(posts)) {
    const objectorsByTarget = new Map(); // target ("on") -> Set(lab)
    const objectionsByLab = new Map();   // lab -> [target, ...]
    for (const p of posts) {
      if (p.stance !== 'object' || !p.by || !p.on) continue;
      if (!objectorsByTarget.has(p.on)) objectorsByTarget.set(p.on, new Set());
      objectorsByTarget.get(p.on).add(p.by);
      if (!objectionsByLab.has(p.by)) objectionsByLab.set(p.by, []);
      objectionsByLab.get(p.by).push(p.on);
    }
    for (const [labName, targets] of objectionsByLab) {
      const lab = byLab.get(labName) || emptyLabAgg();
      for (const target of targets) {
        lab.objections += 1;
        if (objectorsByTarget.get(target).size === 1) lab.novelObjections += 1;
      }
      byLab.set(labName, lab);
    }
  }

  const signoff = Array.isArray(report.signoff) ? report.signoff : [];
  for (const s of signoff) {
    if (s.signedOff !== true || !s.provider) continue;
    const lab = byLab.get(s.provider) || emptyLabAgg();
    lab.signoffs += 1;
    const anotherStillObjects = signoff.some(o =>
      o.provider !== s.provider && (o.signedOff === false || (Array.isArray(o.objections) && o.objections.length > 0)));
    if (anotherStillObjects) lab.soloSignoffs += 1;
    byLab.set(s.provider, lab);
  }
}

// Round number a stage label belongs to, e.g. "panel-2-glm" -> 2,
// "revise-1" -> 1. Stages with no round (criteria, skeleton, build, ...)
// return null and don't count toward round totals.
function roundOf(label) {
  const m = label.match(/^(?:panel|critique|revise)-(\d+)/);
  return m ? Number(m[1]) : null;
}

function largestPromptByStageType(dir, files, out) {
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const type = f.replace(/^NEEDS-/, '').replace(/-[a-z0-9]+\.md$/, '').replace(/\.md$/, '').replace(/-\d+$/, '');
    let size = 0;
    try { size = statSync(join(dir, f)).size; } catch { continue; }
    const cur = out.get(type);
    if (!cur || size > cur.bytes) out.set(type, { bytes: size, file: f });
  }
}

/**
 * Verdict/quality stats across every run in `runsDir` within the last `days`.
 * Never throws - a missing or unreadable runs/ means no data, not an error.
 */
export function verdictStats(runsDir, { days = 30, now = Date.now(), novelObjectionFloor = 0.10, soloSignoffCeiling = 0.60 } = {}) {
  const cutoff = now - days * 24 * 3600 * 1000;
  const byChain = new Map();
  const byLab = new Map();
  const largestPrompt = new Map(); // stage type -> { bytes, file, run }
  let runsSeen = 0;
  let unreadable = 0;

  let ids = [];
  try {
    ids = existsSync(runsDir) ? readdirSync(runsDir) : [];
  } catch {
    return { runsDir, days, since: new Date(cutoff), chains: [], labs: [], largestPrompts: [],
             runsSeen: 0, unreadable: 0, note: 'runs directory could not be read' };
  }

  for (const id of ids) {
    const when = runIdToDate(id);
    if (!when || when.getTime() < cutoff) continue;
    const dir = join(runsDir, id);
    let files;
    try {
      if (!statSync(dir).isDirectory()) continue;
      files = readdirSync(dir);
    } catch { unreadable += 1; continue; }

    const runJson = readJson(join(dir, 'run.json'));
    const report = readJson(join(dir, 'report.json'));
    const chainName = report?.chain ?? runJson?.chain ?? 'unknown';
    runsSeen += 1;

    for (const [type, entry] of (() => {
      const local = new Map();
      largestPromptByStageType(dir, files, local);
      return local;
    })()) {
      const cur = largestPrompt.get(type);
      if (!cur || entry.bytes > cur.bytes) largestPrompt.set(type, { ...entry, run: id });
    }

    if (!report) continue; // incomplete/paused run: no verdict to score yet

    const chain = byChain.get(chainName) || emptyChainAgg();
    chain.runs += 1;

    const signoff = Array.isArray(report.signoff) ? report.signoff : [];
    const anySignedOff = signoff.length > 0 && signoff.every(s => s.signedOff === true || s.signedOff === null);
    const allSignedOff = signoff.length > 0 && signoff.some(s => s.signedOff === true) &&
      signoff.every(s => s.signedOff === true || s.signedOff === null);
    if (report.passed === true || allSignedOff) chain.signedOff += 1;

    for (const s of signoff) {
      if (s.signedOff === null) chain.unparseable += 1; // abstention
      else if (Array.isArray(s.objections)) chain.objections += s.objections.length;
    }

    const rounds = (report.stages || []).map(s => roundOf(s.label)).filter(n => n !== null);
    if (rounds.length && (report.passed === true || allSignedOff)) {
      chain.roundsToSignoff.push(Math.max(...rounds));
    }

    chain.dropouts += (report.dropouts || []).length;
    chain.shapeOnlyRounds += shapeRounds(dir).shapeOnlyRounds;

    const rows = report.scoreboard?.rows || [];
    for (const row of rows) {
      if (row.withdrawn) chain.withdrawals += 1;
      if (row.status === 'accepted') chain.accepted += 1;
    }

    if (report.totals?.usd !== undefined && report.totals.usd !== null) chain.costs.push(report.totals.usd);
    const wallMs = (report.stages || []).reduce((s, st) => s + (st.ms || 0), 0);
    if (wallMs) chain.wallMs.push(wallMs);

    byChain.set(chainName, chain);
    accumulateIndependence(report, byLab);

    for (const l of report.scoreboard?.labs || []) {
      const lab = byLab.get(l.lab) || emptyLabAgg();
      lab.proposed += l.proposed || 0;
      lab.accepted += l.accepted || 0;
      lab.withdrawn += l.withdrawn || 0;
      lab.cut += l.cut || 0;
      byLab.set(l.lab, lab);
    }
    for (const d of report.dropouts || []) {
      const lab = byLab.get(d.lab) || emptyLabAgg();
      lab.dropouts += 1;
      byLab.set(d.lab, lab);
    }
    for (const s of signoff) {
      if (s.signedOff === null) {
        const lab = byLab.get(s.provider) || emptyLabAgg();
        lab.unparseable += 1;
        byLab.set(s.provider, lab);
      }
    }
  }

  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  const chains = [...byChain.entries()].map(([name, c]) => ({
    chain: name,
    runs: c.runs,
    signoffRate: c.runs ? c.signedOff / c.runs : null,
    meanRoundsToSignoff: mean(c.roundsToSignoff),
    objections: c.objections,
    withdrawals: c.withdrawals,
    accepted: c.accepted,
    dropouts: c.dropouts,
    shapeOnlyRounds: c.shapeOnlyRounds,
    unparseable: c.unparseable,
    meanCostUsd: mean(c.costs),
    meanWallMs: mean(c.wallMs),
  })).sort((a, b) => b.runs - a.runs);

  const labs = [...byLab.entries()].map(([name, l]) => {
    const novelObjectionRate = l.objections ? l.novelObjections / l.objections : null;
    const soloSignoffRate = l.signoffs ? l.soloSignoffs / l.signoffs : null;
    const lowIndependence = novelObjectionRate !== null && soloSignoffRate !== null &&
      novelObjectionRate < novelObjectionFloor && soloSignoffRate > soloSignoffCeiling;
    return {
      lab: name,
      proposed: l.proposed,
      accepted: l.accepted,
      withdrawn: l.withdrawn,
      cut: l.cut,
      dropouts: l.dropouts,
      unparseable: l.unparseable,
      objections: l.objections,
      novelObjections: l.novelObjections,
      novelObjectionRate,
      signoffs: l.signoffs,
      soloSignoffs: l.soloSignoffs,
      soloSignoffRate,
      lowIndependence,
    };
  }).sort((a, b) => b.proposed - a.proposed);

  const largestPrompts = [...largestPrompt.entries()]
    .map(([type, v]) => ({ stageType: type, bytes: v.bytes, tokensApprox: Math.round(v.bytes / 4), file: v.file, run: v.run }))
    .sort((a, b) => b.bytes - a.bytes);

  return { runsDir, days, since: new Date(cutoff), chains, labs, largestPrompts, runsSeen, unreadable };
}

const csvNum = x => (x === null ? '' : String(x));

/**
 * `labs` from verdictStats() as an independence-skew CSV: one row per lab,
 * numbers only, no interpretation strings.
 */
export function independenceStatsCsv(labs) {
  const header = 'lab,objections,novelObjections,novelObjectionRate,signoffs,soloSignoffs,soloSignoffRate,lowIndependence';
  const rows = labs.map(l =>
    [l.lab, l.objections, l.novelObjections, csvNum(l.novelObjectionRate), l.signoffs, l.soloSignoffs, csvNum(l.soloSignoffRate), l.lowIndependence].join(','));
  return [header, ...rows].join('\n');
}
