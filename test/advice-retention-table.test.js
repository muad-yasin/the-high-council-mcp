// RET-1 (lane E, 23 Okt 2026, the retention re-check): the table says what its own fields say. A row's class, its tag arrays and the words a person reads in the send preview
// must agree, so a refresh that moves a tag array cannot leave a sentence that contradicts it ("no EU tag" next to an EU-tagged endpoint). Nothing here reads a live list: the tags
// are the file's own. The class letters themselves are pinned in advice-units.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const TABLE = JSON.parse(readFileSync(new URL('../src/advice-retention.json', import.meta.url), 'utf8'));
// the build script's EU rule (thc-research brief 31, scripts/build-retention-classes.mjs): a tag with an "eu" part or "europe" in it
const isEu = t => /(^|[\/-])eu|europe/i.test(t);

test('RET-1: class, tag arrays and wording of every row agree', () => {
  const rows = Object.entries(TABLE.seats);
  assert.ok(rows.length >= 13, `the table has ${rows.length} rows`);
  for (const [id, r] of rows) {
    const say = msg => `${id} (class ${r.class}): ${msg}`;
    if (r.class === 'A' || r.class === 'B') assert.ok(r.zdrTags.length > 0, say('a ZDR-tagged class has at least one tag'));
    if (r.class === 'C' || r.class === 'D') assert.equal(r.zdrTags.length, 0, say('a class with no ZDR endpoint lists no tag'));
    if (r.class === 'A') assert.ok(r.euZdrTags.length > 0, say('class A means at least one EU-tagged endpoint'));
    assert.deepEqual(r.euZdrTags, r.zdrTags.filter(isEu), say('euZdrTags is exactly the EU-looking tags of zdrTags'));
    if (/\bno EU tag\b/.test(r.wording)) assert.equal(r.euZdrTags.length, 0, say('the wording says "no EU tag" but the row lists one'));
    // a class B row that HAS an EU-tagged endpoint is B because the price limit it is judged at cannot reach it: the wording must say so (RET-2 holds which limit, and which kind of sentence)
    if (r.class === 'B' && r.euZdrTags.length) assert.match(r.wording, /reach/, say('an EU endpoint that is not reached is named in the wording'));
  }
});

// RET-2 (lane E, 23 Okt 2026, C&C thcmcp-cd's ruling on the "this seat's max_price" trace): the table is keyed by MODEL, a shipped chain sets the PRICE LIMIT, so a sentence about what a price limit does not
// reach is true only for the limit it names. The seats are the ones src/send-path-refusals.js seatsOf sends to: the critics, plus the builder when the chain's synthesis is "seat".
const CHAINS = new URL('../chains/', import.meta.url);
function shippedLimits() {
  const by = new Map(); let files = 0, seats = 0;
  for (const f of readdirSync(CHAINS).filter(n => /^advise-.*\.json$/.test(n))) {
    files++;
    const c = JSON.parse(readFileSync(new URL(f, CHAINS), 'utf8'));
    for (const s of [...(c.seats.critics || []), ...(c.advise?.synthesis === 'seat' && c.seats.builder ? [c.seats.builder] : [])]) {
      seats++;
      const mp = s.extra?.provider?.max_price;
      const key = `${s.provider}/${s.model}`;
      if (!by.has(key)) by.set(key, new Map());
      by.get(key).set(`$${mp?.prompt} in / $${mp?.completion} out per million tokens`, f);   // the same money words the price-refusal text uses
    }
  }
  return { by, files, seats };
}

test('RET-2: a reach sentence names the price limit the shipped chains carry; a model no shipped chain seats makes no reach claim; no row says max_price', () => {
  const { by, files, seats } = shippedLimits();
  assert.ok(files >= 8 && seats >= 10, `found ${files} advise chains and ${seats} seats: the glob read too little`);
  for (const [model, limits] of by) assert.equal(limits.size, 1, `${model}: the shipped chains carry ${limits.size} different price limits (${[...limits.keys()].join(' | ')}): one sentence cannot be true for all of them`);
  for (const [id, r] of Object.entries(TABLE.seats)) {
    const say = msg => `${id}: ${msg}`;
    assert.ok(!/max_price/.test(r.wording), say('the wording says "max_price"; a person reads "price limit"'));
    if (!/reach/.test(r.wording)) continue;
    const limits = by.get(id);
    if (limits) {
      assert.ok(r.wording.includes([...limits.keys()][0]), say(`the wording talks about reach but does not name the shipped price limit "${[...limits.keys()][0]}"`));
      if (r.class === 'B' && r.euZdrTags.length) assert.match(r.wording, /does not reach/, say('a class B row with an EU endpoint says that a seat at the shipped limit does not reach it'));
    }
    else {
      assert.ok(!/does not reach/.test(r.wording), say('no shipped chain seats this model, so there is no shipped price limit to say "does not reach" about'));
      assert.match(r.wording, /depends on the seat's price limit/, say('a reach sentence for a model no shipped chain seats says that it depends on the seat\'s price limit'));
    }
  }
});
