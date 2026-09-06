// Fenced-code checkboxes must never count as open/done plan steps, or get picked as the "next"
// item. Bug: a dropshit plan quoted a new PLAN.md's content inside a ``` block as spec text;
// brief counted those 10 quoted checkboxes as real plan steps (8/18 instead of 8/8). Fix:
// `unfencedLines` (src/docs.ts) blanks any line inside a fenced code block before the existing
// checkbox/bullet regexes ever see it — used by `plansFor`, `extractNext`, and `nextItem`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractNext, nextItem, plansFor, unfencedLines } from '../src/docs.js';

// Fenced block comes FIRST so a fence-blind implementation would pick a quoted line as "next"
// or inflate the open count — a fence placed after the real step would pass even with the bug.
const backtickPlan = [
  '# S6 docs debt',
  '',
  'Spec text for the new PLAN.md, quoted verbatim:',
  '',
  '```',
  '- [ ] **S1** fenced one',
  '- [ ] **S2** fenced two',
  '- [ ] **S3** fenced three',
  '- [x] fenced done',
  '```',
  '',
  '- [x] real step 1',
  '- [x] real step 2',
  '- [ ] real open step',
  '',
].join('\n');

const tildePlan = backtickPlan.replace(/```/g, '~~~');

test('unfencedLines: blanks lines inside a ``` fence (markers too), preserves index/length', () => {
  const lines = unfencedLines(backtickPlan);
  assert.equal(lines.length, backtickPlan.split('\n').length);
  assert.deepEqual(
    lines.filter((l) => l !== ''),
    ['# S6 docs debt', 'Spec text for the new PLAN.md, quoted verbatim:', '- [x] real step 1', '- [x] real step 2', '- [ ] real open step'],
  );
});

test('unfencedLines: ~~~ fence works the same way', () => {
  const lines = unfencedLines(tildePlan);
  assert.deepEqual(
    lines.filter((l) => l !== ''),
    ['# S6 docs debt', 'Spec text for the new PLAN.md, quoted verbatim:', '- [x] real step 1', '- [x] real step 2', '- [ ] real open step'],
  );
});

test('extractNext: fenced checkboxes are not counted and not returned as next', () => {
  const r = extractNext(backtickPlan, 5, false);
  assert.equal(r.open, 1);
  assert.equal(r.done, 2);
  assert.deepEqual(r.next, ['real open step']);
});

test('extractNext: same result through a ~~~ fence', () => {
  const r = extractNext(tildePlan, 5, false);
  assert.equal(r.open, 1);
  assert.equal(r.done, 2);
  assert.deepEqual(r.next, ['real open step']);
});

test('nextItem: skips fenced opens, picks the real open step at its true line number', () => {
  const item = nextItem(backtickPlan)!;
  assert.equal(item.text, '- [ ] real open step');
  const realLine = backtickPlan.split('\n').findIndex((l) => l === '- [ ] real open step') + 1;
  assert.equal(item.line, realLine);
});

test('plansFor: a plans/*.md with a fenced spec block counts only the real steps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brief-fenced-plans-'));
  mkdirSync(join(dir, 'plans'));
  writeFileSync(join(dir, 'plans', 'a.md'), backtickPlan);
  assert.deepEqual(plansFor(dir), [{ file: 'a.md', open: 1, done: 2 }]);
});
