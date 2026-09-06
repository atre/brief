// Acceptance tests for plans/2026-09-05-sections-missing-plans-forks.md — failing at authoring time by design.
// Do not edit these while executing the plan; the plan is done when they pass unmodified.
// Forward-compat casts keep the build green until the exports exist; tests then fail at runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from '../src/cli.js';
import * as collectMod from '../src/collect.js';
import * as docs from '../src/docs.js';
import * as render from '../src/render.js';
import { score } from '../src/score.js';
import type { Repo, Report } from '../src/types.js';

const NOW = Date.parse('2026-08-16T12:00:00Z');
type PlanInfo = { file: string; open: number; done: number };
const selectSections = (render as unknown as { selectSections: (r: Repo, s: string[]) => Partial<Repo> }).selectSections;
const selectReport = (render as unknown as { selectReport: (rep: Report, s: string[]) => unknown }).selectReport;
const renderFeedback = render.renderFeedback as unknown as (rep: Report, opts?: { headers?: boolean; missing?: boolean }) => string;
const plansFor = (docs as unknown as { plansFor: (dir: string) => PlanInfo[] }).plansFor;
const tagSharedDescriptions = (collectMod as unknown as { tagSharedDescriptions: (repos: Repo[]) => void }).tagSharedDescriptions;

const git = { branch: 'main', dirty: 0, untracked: 0, ahead: 0, unpushedSince: 0, behind: 0, noUpstream: false, lastCommitTs: NOW, lastCommitMsg: 'init', dirtyFiles: [], recent: [] };
const repo = (name: string, over: Partial<Repo> = {}): Repo =>
  ({ name, path: `/r/${name}`, description: '', git, docs: [], feedback: null, sessions: { last: 0, count7d: 0 }, snuff: false, deadPaths: [], score: 0, reasons: [], ...over }) as unknown as Repo;
const item = (header: string) => ({ header, ts: Date.parse(header.slice(0, 10)), preview: 'p' });
const fb = (items: ReturnType<typeof item>[]) => ({ sections: items.length, untriaged: items.map((i) => i.header), items, lessons: [] });

// ── --json --section ──────────────────────────────────────────────────

test('--section: repeatable + comma list, needs --json, unknown names error with the valid list', () => {
  assert.deepEqual((parseArgs(['looksy', '--json', '--section', 'git,docs', '--section', 'feedback'], '/h') as unknown as { sections?: string[] }).sections, ['git', 'docs', 'feedback']);
  assert.throws(() => parseArgs(['looksy', '--section', 'git'], '/h'), /--section needs --json/);
  assert.throws(() => parseArgs(['--json', '--section', 'nope'], '/h'), /unknown section nope \(valid: .*\bgit\b.*\)/);
});

test('selectSections / selectReport emit exactly the named keys (plus name inside repos[])', () => {
  const r = repo('x', { description: 'd', docs: [] });
  assert.deepEqual(Object.keys(selectSections(r, ['git', 'docs'])).sort(), ['docs', 'git']);
  const rep: Report = { root: ['/r'], now: NOW, findings: [], repos: [r] };
  const out = selectReport(rep, ['git']) as { root: string[]; now: number; repos: Record<string, unknown>[] };
  assert.deepEqual(Object.keys(out).sort(), ['now', 'repos', 'root']);
  assert.deepEqual(Object.keys(out.repos[0]).sort(), ['git', 'name']);
});

// ── brief feedback --missing ─────────────────────────────────────────

test('--missing: parses for feedback only; lists git repos with no FEEDBACK.md; default view gets a footer', () => {
  assert.equal((parseArgs(['feedback', '--missing'], '/h') as unknown as { missing?: boolean }).missing, true);
  assert.throws(() => parseArgs(['--missing'], '/h'), /--missing is only valid for `brief feedback`/);
  const rep: Report = {
    root: ['/r'], now: NOW, findings: [],
    repos: [
      repo('x', { feedback: fb([item('2026-08-20 — a')]) }),
      repo('y', { feedback: fb([]) }), // has the file, nothing untriaged
      repo('z'), // git repo, feedback: null → no FEEDBACK.md
      repo('w', { git: null }), // docs-only, never counted
    ],
  };
  const missing = renderFeedback(rep, { missing: true }).split('\n');
  assert.equal(missing[0], 'feedback — 1 repo with no FEEDBACK.md');
  assert.deepEqual(missing.slice(1), ['z — /r/z']);
  const dflt = renderFeedback(rep).split('\n');
  assert.equal(dflt[dflt.length - 1], '1 repo with no FEEDBACK.md (brief feedback --missing)');
  const none: Report = { ...rep, repos: rep.repos.filter((r) => r.name !== 'z') };
  assert.doesNotMatch(renderFeedback(none), /no FEEDBACK\.md/);
});

// ── plans/*.md progress ──────────────────────────────────────────────

test('plansFor counts unticked/ticked steps per plans/*.md, name order, non-md ignored, no dir → []', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brief-plans-'));
  mkdirSync(join(dir, 'plans'));
  writeFileSync(join(dir, 'plans', 'b.md'), '# b\n- [x] 1. done\n- [x] 2. done\n');
  writeFileSync(join(dir, 'plans', 'a.md'), '# a\n- [x] 1.\n- [x] 2.\n- [x] 3.\n- [ ] 4.\n- [ ] 5.\n- [ ] 6.\n- [ ] 7.\n- [ ] 8.\n');
  writeFileSync(join(dir, 'plans', 'notes.txt'), '- [ ] not a plan\n');
  assert.deepEqual(plansFor(dir), [{ file: 'a.md', open: 5, done: 3 }, { file: 'b.md', open: 0, done: 2 }]);
  assert.deepEqual(plansFor(mkdtempSync(join(tmpdir(), 'brief-noplans-'))), []);
});

test('handoff shows open plans with progress, hides finished ones; plans never move the score', () => {
  const plans: PlanInfo[] = [{ file: 'a.md', open: 5, done: 3 }, { file: 'b.md', open: 0, done: 2 }];
  const withPlans = repo('x', { plans } as unknown as Partial<Repo>);
  const text = render.renderRepo(withPlans, NOW, { files: 10, commits: 3, next: 3 });
  assert.match(text, /^plans: 1 open \(a\.md 3\/8\) · 1 done$/m);
  assert.doesNotMatch(text, /b\.md/);
  assert.doesNotMatch(render.renderRepo(repo('x'), NOW, { files: 10, commits: 3, next: 3 }), /^plans:/m);
  assert.equal(score(withPlans, NOW).score, score(repo('x'), NOW).score);
});

// ── fork detection ───────────────────────────────────────────────────

test('tagSharedDescriptions: byte-identical descriptions tag both repos (+1, once); one char clears; empty never tagged', () => {
  const a = repo('a', { description: 'A universal multiplayer game template.' });
  const b = repo('b', { description: 'A universal multiplayer game template.' });
  const c = repo('c', { description: 'A universal multiplayer game template!' });
  const d = repo('d', { description: '' });
  const e = repo('e', { description: '' });
  tagSharedDescriptions([a, b, c, d, e]);
  assert.deepEqual(a.reasons, ['description shared with b']);
  assert.deepEqual(b.reasons, ['description shared with a']);
  assert.equal(a.score, 1);
  assert.equal(b.score, 1);
  for (const r of [c, d, e]) { assert.deepEqual(r.reasons, []); assert.equal(r.score, 0); }
  const three = [repo('p', { description: 'same' }), repo('q', { description: 'same' }), repo('r', { description: 'same' })];
  tagSharedDescriptions(three);
  assert.deepEqual(three[0].reasons, ['description shared with q +1']);
});
