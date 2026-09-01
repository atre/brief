// Acceptance tests for plans/2026-08-30-feedback-round.md — written before the code; they
// fail at authoring and pass unmodified when the plan is done.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { feedbackInfo } from '../src/docs.js';
import { renderFeedback, renderRepo } from '../src/render.js';
import { runtimeFor } from '../src/runtime.js';
import { collectOne } from '../src/collect.js';
import type { Report } from '../src/types.js';

const NOW = Date.parse('2026-08-30T12:00:00Z');
const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: '2026-08-10T10:00:00Z', GIT_COMMITTER_DATE: '2026-08-10T10:00:00Z' } });

function mkRepo(root: string, name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), c);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

test('feedback: only a "<date> — triage" header is a marker; every dated section after it is untriaged whatever PLAN.md\'s mtime', () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  const fb = join(root, 'FEEDBACK.md');
  writeFileSync(
    fb,
    [
      '# fb',
      '## 2026-08-01 — a',
      '- old',
      '## 2026-08-05 — triage',
      '- did it',
      '## 2026-08-10 — b',
      '- hidden by the PLAN.md-mtime day rule today',
      '## 2026-08-12 — session (inbox triage)',
      '- merely mentions triage — NOT a marker',
      '## 2026-08-20 — c',
      '- newest',
      '## undated',
      '- x',
      '',
    ].join('\n'),
  );
  // PLAN.md touched after every section: must not hide anything
  const fi = feedbackInfo(root, Date.parse('2026-08-25T12:00:00'))!;
  assert.deepEqual(fi.untriaged, ['2026-08-10 — b', '2026-08-12 — session (inbox triage)', '2026-08-20 — c']);
  assert.equal(fi.sections, 6);

  // a marker with a parenthesised suffix is still a marker
  writeFileSync(fb, '# fb\n## 2026-08-01 — a\n- old\n## 2026-08-15 — triage (post-execution)\n- marked\n## 2026-08-20 — d\n- new\n');
  assert.deepEqual(feedbackInfo(root, Date.parse('2026-08-25T12:00:00'))!.untriaged, ['2026-08-20 — d']);

  // no marker at all → every dated section is untriaged; undated ones only when there is no plan doc
  writeFileSync(fb, '# fb\n## 2026-08-01 — old\n- a\n## 2026-08-15 — new\n- b\n## undated\n- c\n');
  assert.deepEqual(feedbackInfo(root, Date.parse('2026-08-20'))!.untriaged, ['2026-08-01 — old', '2026-08-15 — new']);
  assert.deepEqual(feedbackInfo(root, 0)!.untriaged, ['2026-08-01 — old', '2026-08-15 — new', 'undated']);
});

test('feedback: header and empty line name the triage-marker rule, not PLAN.md mtime', () => {
  const rep: Report = { root: ['/x'], now: NOW, findings: [], repos: [] };
  const out = renderFeedback(rep);
  assert.equal(out.split('\n')[0], 'feedback — 0 untriaged sections in 0 repos (after each repo\'s last "## <date> — triage" marker)');
  assert.match(out, /^nothing untriaged — every dated section sits above a triage marker$/m);
});

test('docs: a configured nextHeading that matches no heading is reported, never silently empty', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  const dir = mkRepo(root, 'r', { 'STATE.md': '# s\n## Session 3\n- did things\n', '.brief.yaml': 'nextHeading: open\n' });
  const repo = (await collectOne('r', dir, NOW, new Map()))!;
  assert.equal(JSON.parse(JSON.stringify(repo.docs[0])).nextHeadingMissing, 'open');
  const out = renderRepo(repo, NOW, { files: 5, commits: 3, next: 5 });
  assert.match(out, /^next \(STATE\.md\): nextHeading "open" not found$/m);
  // heading present → no flag, no line
  writeFileSync(join(dir, 'STATE.md'), '# s\n## Open items\n- ship\n');
  const ok = (await collectOne('r', dir, NOW, new Map()))!;
  assert.equal(JSON.parse(JSON.stringify(ok.docs[0])).nextHeadingMissing, undefined);
  assert.deepEqual(ok.docs[0].next, ['ship']);
  assert.doesNotMatch(renderRepo(ok, NOW, { files: 5, commits: 3, next: 5 }), /not found/);
});

test('runtime: service ids may name node:/disk:/host: findings; a bare id matches any kind', () => {
  const f = [
    { id: 'node:edge', severity: 'warn' },
    { id: 'disk:edge:/mnt/ssd', severity: 'crit' },
    { id: 'host:box', severity: 'ok' },
    { id: 'k8s:app/svc', severity: 'ok' },
  ];
  assert.equal(runtimeFor('node:*', f), 'warn');
  assert.equal(runtimeFor('node:edge', f), 'warn');
  assert.equal(runtimeFor('disk:*', f), 'crit');
  assert.equal(runtimeFor('host:*', f), 'ok');
  assert.equal(runtimeFor('node:*, disk:*, host:*', f), 'crit');
  assert.equal(runtimeFor('edge', f), 'crit'); // bare id: any kind, and disk:edge:/mnt/ssd is edge namespaced one level deeper
  assert.equal(runtimeFor('app/svc', f), 'ok');
  assert.equal(runtimeFor('app/svc', [{ id: 'k8s:other', severity: 'crit' }]), 'ok');
});
