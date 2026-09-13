#!/usr/bin/env node
// v6 phase 5: prints the exact debate-stage SYSTEM prompt a critic seat would receive under
// chains/plan-debate-roles-c1.json, for each seat, using the same call this repo's own
// src/chain.js makes (applySeatRole(R.DEBATE_SYSTEM, seat.role)) - not a re-derivation of the
// prompt-building logic. Free: no provider is invoked, no API key is read, nothing is sent
// anywhere. Run: node scripts/preview-role-prompt.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../src/roles.js';
import { applySeatRole } from '../src/seat-role.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(root, 'chains', 'plan-debate-roles-c1.json'), 'utf8'));

for (const seat of cfg.seats.critics) {
  const prompt = applySeatRole(R.DEBATE_SYSTEM, seat.role);
  console.log('='.repeat(72));
  console.log(`SEAT: ${seat.lab}  (lens: ${seat.role.lens}, persona: ${seat.role.persona})`);
  console.log('='.repeat(72));
  console.log(prompt);
  console.log(`\n[base prompt: ${R.DEBATE_SYSTEM.length} chars] [with role: ${prompt.length} chars] [role block: ${prompt.length - R.DEBATE_SYSTEM.length} chars, ${(((prompt.length - R.DEBATE_SYSTEM.length) / prompt.length) * 100).toFixed(1)}% of the total prompt]\n`);
}
