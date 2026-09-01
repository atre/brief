import test from 'node:test';
import assert from 'node:assert/strict';
import { toFindings } from '../src/findings.js';
import type { Repo } from '../src/types.js';

const NOW = Date.parse('2026-09-01T00:00:00Z');

function repo(name: string, over: Partial<Repo> = {}): Repo {
  return {
    name, path: `/r/${name}`, description: '', docs: [], feedback: null, git: null,
    sessions: { last: NOW, count7d: 0 }, snuff: false, deadPaths: [], fatDocs: [],
    score: 0, reasons: [], ...over,
  };
}

test('toFindings: contract shape, ranked by score, quiet repos omitted', () => {
  const f = toFindings([
    repo('quiet'),
    repo('warm', { score: 5, reasons: ['3 dirty'] }),
    repo('hot', { score: 21, reasons: ['12 dirty', '2 unpushed'] }),
  ]);

  assert.deepEqual(f.map((x) => x.id), ['repo:hot', 'repo:warm'], 'score order, and score 0 says nothing');
  for (const x of f) {
    assert.deepEqual(Object.keys(x).sort(), ['detail', 'hint', 'id', 'scope', 'severity', 'title'].sort());
    assert.equal(x.scope, 'repo');
    assert.ok(['crit', 'warn', 'ok'].includes(x.severity));
  }
  assert.equal(f[0].title, 'hot — 12 dirty · 2 unpushed', 'the reasons are the finding — no re-derivation');
  assert.equal(f[0].detail, 'attention score 21');
  assert.equal(f[0].hint, 'brief hot', 'the per-repo view is the next action');
});

test('toFindings: crit only when another tool already said red — red gates, failed CI, crit runtime', () => {
  const sev = (r: Repo) => toFindings([r])[0].severity;

  assert.equal(sev(repo('dirty-only', { score: 9, reasons: ['9 dirty'] })), 'warn', 'unattended is not broken');
  assert.equal(sev(repo('stale', { score: 12, reasons: ['stale-dirty 9d'] })), 'warn');

  assert.equal(sev(repo('g', { score: 4, reasons: ['gates ✗ test'], gates: { ok: false, red: ['test'], passed: 3, total: 4, ts: NOW } })), 'crit');
  assert.equal(sev(repo('c', { score: 5, reasons: ['ci ✗'], ci: { state: 'fail' } as Repo['ci'] })), 'crit');
  assert.equal(sev(repo('p', { score: 6, reasons: ['runtime ✗'], runtime: 'crit' })), 'crit');

  // green gates present is not a crit — the absence of red is what matters
  assert.equal(sev(repo('ok', { score: 2, reasons: ['gates stale 5d'], gates: { ok: true, red: [], passed: 4, total: 4, ts: NOW } })), 'warn');
});
