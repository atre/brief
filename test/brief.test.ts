import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { discover } from '../src/discover.js';
import { firstParagraph, extractNext, feedbackInfo, docInfos } from '../src/docs.js';
import { gitInfo } from '../src/git.js';
import { score } from '../src/score.js';
import { tableNames, hubDiff, applyHubWrite } from '../src/hub.js';
import { slugFor, indexSessions, sessionsFor } from '../src/sessions.js';
import { collectOne } from '../src/collect.js';
import { attachTokens, fmtTokens } from '../src/tokens.js';
import { readSnuffLast } from '../src/gates.js';
import { deadPaths } from '../src/docs.js';
import { runtimeFor } from '../src/runtime.js';
import { lastAssistantText, lastAssistantTail } from '../src/sessions.js';
import { nextItem } from '../src/docs.js';
import { buildQueue } from '../src/queue.js';
import { diffSnaps } from '../src/snap.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { renderText, renderRepo, groupFiles, ago, renderLessons, renderLessonsMd, renderQueue, renderDiff } from '../src/render.js';
import { parseArgs } from '../src/cli.js';
import type { Repo } from '../src/types.js';

const NOW = Date.parse('2026-08-16T12:00:00Z');
const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: '2026-08-10T10:00:00Z', GIT_COMMITTER_DATE: '2026-08-10T10:00:00Z' } });

function mkRepo(root: string, name: string, files: Record<string, string>, commit = true): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), c);
  }
  if (commit) {
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'init');
  }
  return dir;
}

test('discover: direct repos, one-level containers, exclude', () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  mkRepo(root, 'a', { 'README.md': 'A' });
  mkRepo(root, 'acme/x', { 'README.md': 'x' });
  mkRepo(root, 'acme/y-worktree-1', { 'README.md': 'y' });
  mkdirSync(join(root, 'plain'));
  const names = discover([root], ['worktree']).map((c) => c.name);
  assert.deepEqual(names, ['a', 'acme/x']);
});

test('discover: an umbrella repo that contains repos lists both', () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  mkRepo(root, 'acme', { 'CLAUDE.md': 'umbrella' });
  mkRepo(root, 'acme/x', { 'README.md': 'x' });
  mkRepo(root, 'acme/y', { 'README.md': 'y' });
  assert.deepEqual(discover([root]).map((c) => c.name), ['acme', 'acme/x', 'acme/y']);
  // the umbrella itself as --root behaves the same (brief --root ~/git/acme)
  assert.deepEqual(discover([join(root, 'acme')], ['y']).map((c) => c.name), ['acme', 'acme/x']);
});

test('firstParagraph: skips headings/badges/boilerplate, joins wrapped lines, first sentence', () => {
  const md = '# x\n[![CI](u)](u)\n\nThis file provides guidance to Claude Code.\n\nLog triage **compressor**. Pipe in\nthousands of lines. More.\n';
  assert.equal(firstParagraph(md), 'Log triage compressor.'.length < 25 ? 'Log triage compressor. Pipe in thousands of lines. More.' : 'x');
  assert.equal(firstParagraph('# t\n\nA cross-repo radar for many repos, ranked by attention.\n\nsecond'), 'A cross-repo radar for many repos, ranked by attention.');
  assert.equal(firstParagraph('```\ncode\n```\n'), '');
});

test('extractNext: heading bullets first, then open checkboxes; Next.js is not a cue', () => {
  const md = '# STATE\n## Next.js notes\n- not this\n## Next\n- do A\n- [x] done B\n- do C\n## Later\n- [ ] open D\n- [ ] open E\n';
  const r = extractNext(md);
  assert.deepEqual(r.next, ['do A', 'do C', 'open D', 'open E']);
  assert.equal(r.open, 2);
  assert.equal(r.done, 1);
  const prose = extractNext('# STATE — resume here\n\nRead this first in a new session.\n\n## Other\n- x\n');
  assert.deepEqual(prose.next, ['Read this first in a new session.']);
  assert.deepEqual(extractNext('- [ ] only\n- bullet', 5, false).next, ['only']);
});

test('feedbackInfo: sections dated after the plan are untriaged', () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  writeFileSync(join(root, 'FEEDBACK.md'), '# fb\n## 2026-08-01 — old\n- a\n## 2026-08-15 — new\n- b\n## undated\n- c\n');
  const fi = feedbackInfo(root, Date.parse('2026-08-10'))!;
  assert.equal(fi.sections, 3);
  assert.deepEqual(fi.untriaged, ['2026-08-15 — new']);
  const none = feedbackInfo(root, 0)!;
  assert.deepEqual(none.untriaged, ['2026-08-01 — old', '2026-08-15 — new', 'undated']);
  assert.equal(feedbackInfo(join(root, 'nope'), 0), null);
});

test('git + docs + score: dirty, unpushed-less, doc staleness', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  const dir = mkRepo(root, 'r', { 'PLAN.md': '# plan\n- [ ] ship\n', 'src/a.ts': '1' });
  // 6 more commits after PLAN.md was last touched
  for (let i = 0; i < 6; i++) {
    writeFileSync(join(dir, 'src/a.ts'), String(i + 2));
    git(dir, 'commit', '-qam', `c${i}`);
  }
  writeFileSync(join(dir, 'src/b.ts'), 'new');
  writeFileSync(join(dir, 'src/a.ts'), 'mod');
  const g = (await gitInfo(dir))!;
  assert.equal(g.branch, 'main');
  assert.equal(g.dirty, 1);
  assert.equal(g.untracked, 1);
  assert.equal(g.noUpstream, true);
  assert.equal(g.recent.length, 5);
  const docs = await docInfos(dir, true);
  assert.equal(docs[0].file, 'PLAN.md');
  assert.equal(docs[0].commitsBehind, 6);
  assert.deepEqual(docs[0].next, ['ship']);
  const repo = (await collectOne('r', dir, NOW, new Map()))!;
  assert.ok(repo.reasons.includes('2 dirty'));
  assert.ok(repo.reasons.some((x) => x.startsWith('PLAN.md 6c stale')));
  assert.equal(repo.score, 2 + 4);
  const text = renderRepo(repo, NOW, { files: 10, commits: 3, next: 3 });
  assert.match(text, /1 modified \+ 1 untracked/);
  assert.match(text, /next \(PLAN.md\):\n {2}- ship/);
});

test('score: stale-dirty needs a session older than 7d; untriaged caps at 12', () => {
  const base: Repo = {
    name: 'x', path: '/x', description: '', docs: [], feedback: { sections: 6, untriaged: ['a', 'b', 'c', 'd', 'e'], items: [], lessons: [] },
    sessions: { last: NOW - 10 * 86_400_000, count7d: 0 }, snuff: true, deadPaths: [], score: 0, reasons: [],
    git: { branch: 'main', dirty: 3, untracked: 0, ahead: 2, unpushedSince: 0, behind: 0, noUpstream: false, lastCommitTs: NOW, lastCommitMsg: '', dirtyFiles: [], recent: [] },
  };
  const s = score(base, NOW);
  assert.equal(s.score, 3 + (5 + 2) + 8 + 12);
  assert.deepEqual(s.reasons, ['3 dirty', '2 unpushed', 'stale-dirty 10d', '5 untriaged feedback']);
});

test('score: dormant (no commit + no session in 180d) caps dirty score, skips stale-dirty', () => {
  const dormant: Repo = {
    name: 'x', path: '/x', description: '', docs: [], feedback: { sections: 0, untriaged: [], items: [], lessons: [] },
    sessions: { last: 0, count7d: 0 }, snuff: true, deadPaths: [], score: 0, reasons: [],
    git: { branch: 'main', dirty: 13, untracked: 0, ahead: 0, unpushedSince: 0, behind: 0, noUpstream: false, lastCommitTs: NOW - 1000 * 86_400_000, lastCommitMsg: '', dirtyFiles: [], recent: [] },
  };
  const s = score(dormant, NOW);
  assert.equal(s.score, 2, 'dormant caps the dirty contribution instead of Math.min(13, 20)');
  assert.deepEqual(s.reasons, ['13 dirty, dormant 33mo']);

  // same dirty count, but a session 10d ago (not dormant) — normal dirty + stale-dirty scoring applies
  const active: Repo = { ...dormant, sessions: { last: NOW - 10 * 86_400_000, count7d: 0 } };
  const sa = score(active, NOW);
  assert.equal(sa.score, 13 + 8);
  assert.deepEqual(sa.reasons, ['13 dirty', 'stale-dirty 10d']);
});

test('sessions: slug encoding and index', () => {
  assert.equal(slugFor('/Users/me/git/example.dev'), '-Users-me-git-example-dev');
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  const slug = slugFor('/Users/me/git/x');
  mkdirSync(join(root, slug));
  writeFileSync(join(root, slug, 's1.jsonl'), '{}');
  const idx = indexSessions(Date.now(), [root]);
  const s = sessionsFor(idx, '/Users/me/git/x');
  assert.equal(s.count7d, 1);
  assert.ok(s.last > 0);
  assert.deepEqual(sessionsFor(idx, '/Users/me/git/none'), { last: 0, count7d: 0 });
});

test('hub: table names incl. ~/git/x rows and a/b cells; diff buckets', () => {
  const md = '| Repo | What |\n|---|---|\n| `a` | A |\n| `~/git/acme` | work |\n| `~/Documents/Notes` | no |\n| `m-go` / `m-py` | t |\n| `gone`, `plain` | later |\n';
  assert.deepEqual([...tableNames(md)].sort(), ['a', 'acme', 'gone', 'm-go', 'm-py', 'plain']);
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  writeFileSync(join(root, 'hub.md'), md);
  mkdirSync(join(root, 'plain'));
  const repos = [{ name: 'a' }, { name: 'new' }, { name: 'acme' }, { name: 'acme/x' }] as Repo[];
  const d = hubDiff(join(root, 'hub.md'), repos, [root]);
  assert.deepEqual(d.missing.map((r) => r.name), ['new']);
  assert.deepEqual(d.gone, ['m-go', 'm-py', 'gone']);
  assert.deepEqual(d.notRepo, ['plain']);
});

test('hub: applyHubWrite inserts missing rows above the no-index row, rebuilds/removes it, idempotent', () => {
  const text = '| Repo | What |\n|---|---|\n| `a` | curated a |\n| `x`, `y` | No index yet — explore on demand |\n';
  const diff = { missing: [{ name: 'b', description: 'new repo b' }] as Repo[], gone: [], notRepo: [], listed: 3 };
  const out = applyHubWrite(text, diff);
  assert.equal(out.text, '| Repo | What |\n|---|---|\n| `a` | curated a |\n| `b` | new repo b |\n| `x`, `y` | No index yet — explore on demand |\n');
  assert.equal(out.noIndex, 'unchanged');
  assert.deepEqual(applyHubWrite(out.text, { ...diff, missing: [] }), { text: out.text, rows: 0, noIndex: 'unchanged' });
  // a seeded name gets its own row → comma list rebuilt without it
  const reb = applyHubWrite(text, { ...diff, missing: [{ name: 'x', description: 'now x' }] as Repo[] });
  assert.equal(reb.text, '| Repo | What |\n|---|---|\n| `a` | curated a |\n| `x` | now x |\n| `y` | No index yet — explore on demand |\n');
  assert.equal(reb.noIndex, 'rebuilt');
  // every seeded name promoted → row removed, reported
  const rem = applyHubWrite(text, { ...diff, missing: [{ name: 'x', description: '' }, { name: 'y', description: 'Y' }] as Repo[] });
  assert.equal(rem.text, '| Repo | What |\n|---|---|\n| `a` | curated a |\n| `x` | — |\n| `y` | Y |\n');
  assert.equal(rem.noIndex, 'removed');
  assert.equal(rem.rows, 2);
});

test('collect: --gates runner sets repo.gates.red and never runs by default', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  const dir = mkRepo(root, 'r', { 'README.md': '# r\n' });
  let calls = 0;
  const gates = async () => {
    calls++;
    return { ok: false, gates: [{ name: 'lint', ok: false, skipped: null }, { name: 'test', ok: true, skipped: null }] };
  };
  const repo = (await collectOne('r', dir, NOW, new Map(), 7, { gates }))!;
  assert.deepEqual(repo.gates!.red, ['lint']);
  assert.match(renderRepo(repo, NOW, { files: 10, commits: 3, next: 3 }), /gates: ✗ 1\/2 — lint/);
  assert.match(renderRepo({ ...repo, gates: { ok: true, red: [], passed: 3, total: 3 } }, NOW, { files: 10, commits: 3, next: 3 }), /gates: ✓ 3\/3/);
  assert.equal(calls, 1);
  await collectOne('r', dir, NOW, new Map());
  assert.equal(calls, 1);
});

test('tokens: attachTokens matches byProject path, fmtTokens formats', () => {
  const repo = { path: '/h/git/acme' } as Repo;
  attachTokens([repo], { byProject: [{ project: 'git/acme', usage: { input: 1, output: 2, cacheRead: 99, cacheCreate: 3 } }] }, '/h');
  assert.equal(repo.tokens7d, 6);
  assert.equal(fmtTokens(1_576_151), '1.6M');
});

test('discover: --docs-root scans non-git dirs with a state doc', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  mkdirSync(join(root, 'Notes'), { recursive: true });
  writeFileSync(join(root, 'Notes', 'STATUS.md'), '# notes\n');
  const cands = discover([], [], [root]);
  assert.deepEqual(cands.map((c) => c.name), ['Notes']);
  assert.equal(cands[0].docsOnly, true);
  const repo = (await collectOne('Notes', cands[0].path, NOW, new Map()))!;
  assert.equal(repo.git, null);
  assert.equal(repo.docs[0].file, 'STATUS.md');
  const line = renderText({ root: [], now: NOW, repos: [repo] }, { top: 10, all: true });
  assert.doesNotMatch(line, /commit/);
});

test('render helpers', () => {
  assert.equal(ago(NOW - 5 * 60_000, NOW), '5min');
  assert.equal(ago(NOW - 3 * 3_600_000, NOW), '3h');
  assert.equal(ago(NOW - 40 * 86_400_000, NOW), '1mo');
  assert.equal(ago(0, NOW), '—');
  assert.deepEqual(groupFiles(['a/1', 'a/2', 'b/1', 'c'], 2), ['a/ ×2', 'b/']);
  const rep = { root: ['/r'], now: NOW, repos: [] as Repo[] };
  assert.match(renderText(rep, { top: 10, all: false }), /^brief — 0 repos/);
});

test('feedback: triage marker and same-day rule', () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  const fb = join(root, 'FEEDBACK.md');
  writeFileSync(fb, '# fb\n## 2026-08-01 — a\n- old\n## 2026-08-05 — triage\n- did it\n## 2026-08-15 — b\n- **new** thing here\n');
  const fbTs = Date.parse('2026-08-15T18:00:00');
  // plan touched on the 15th at noon, FEEDBACK written later that day → same-day counts
  const { utimesSync } = require('node:fs') as typeof import('node:fs');
  utimesSync(fb, fbTs / 1000, fbTs / 1000);
  const fi = feedbackInfo(root, Date.parse('2026-08-15T12:00:00'))!;
  assert.deepEqual(fi.untriaged, ['2026-08-15 — b']);
  assert.equal(fi.items[0].preview, 'new thing here');
  // plan touched later same day, no explicit marker → still untriaged (same-day is never inferred safe)
  assert.deepEqual(feedbackInfo(root, Date.parse('2026-08-15T20:00:00'))!.untriaged, ['2026-08-15 — b']);
  // no plan at all → everything after the triage marker
  assert.deepEqual(feedbackInfo(root, 0)!.untriaged, ['2026-08-15 — b']);
});

test('feedback: --lessons finds "- lesson:" bullets in any section, triaged or not', () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  writeFileSync(
    join(root, 'FEEDBACK.md'),
    '# fb\n## 2026-08-01 — a\n- not a lesson\n- lesson: mocking the db hid a migration bug\n## 2026-08-05 — triage\n- did it\n## 2026-08-15 — b\n- lesson: terse responses only\n',
  );
  const fi = feedbackInfo(root, 0)!;
  assert.deepEqual(fi.lessons, [
    { ts: Date.parse('2026-08-01'), text: 'mocking the db hid a migration bug' },
    { ts: Date.parse('2026-08-15'), text: 'terse responses only' },
  ]);
  const rep = { root: ['/r'], now: NOW, repos: [{ name: 'x', feedback: fi } as unknown as Repo] };
  const text = renderLessons(rep);
  assert.match(text, /mocking the db hid a migration bug/);
  assert.match(text, /terse responses only/);
  const md = renderLessonsMd(rep);
  assert.match(md, /\| x \| 2026-08-01 \| mocking the db hid a migration bug \|/);
});

test('.brief.yaml: stateDoc, nextHeading, description, ignore', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  const dir = mkRepo(root, 'r', {
    'PLAN.md': '# arch\n',
    'docs/status.md': '# s\n## Open items\n- ship it\n- [ ] later\n',
    '.brief.yaml': 'stateDoc: docs/status.md   # comment\nnextHeading: "Open items"\ndescription: my desc\n',
  });
  const repo = (await collectOne('r', dir, NOW, new Map()))!;
  assert.equal(repo.description, 'my desc');
  assert.equal(repo.docs[0].file, 'docs/status.md');
  assert.deepEqual(repo.docs[0].next, ['ship it', 'later']);
  writeFileSync(join(dir, '.brief.yaml'), 'ignore: true\n');
  assert.equal(await collectOne('r', dir, NOW, new Map()), null);
});

test('init: SessionStart hook merge is idempotent and preserves settings', async () => {
  const { mergeSessionHook } = await import('../src/init.js');
  const first = mergeSessionHook('{"permissions":{"allow":["Bash(ls)"]}}');
  assert.equal(first.changed, true);
  const parsed = JSON.parse(first.text) as { permissions: unknown; hooks: { SessionStart: Array<{ hooks: Array<{ command: string; timeout: number }> }> } };
  assert.deepEqual(parsed.permissions, { allow: ['Bash(ls)'] });
  assert.match(parsed.hooks.SessionStart[0].hooks[0].command, /brief \./);
  assert.equal(parsed.hooks.SessionStart[0].hooks[0].timeout, 20);
  assert.equal(mergeSessionHook(first.text).changed, false);
});

test('score: --stale threshold and age tag', () => {
  const r: Repo = {
    name: 'x', path: '/x', description: '', docs: [], feedback: null,
    sessions: { last: NOW - 3 * 86_400_000, count7d: 0 }, snuff: true, deadPaths: [], score: 0, reasons: [],
    git: { branch: 'main', dirty: 1, untracked: 0, ahead: 0, unpushedSince: 0, behind: 0, noUpstream: false, lastCommitTs: NOW, lastCommitMsg: '', dirtyFiles: [], recent: [] },
  };
  assert.deepEqual(score(r, NOW).reasons, ['1 dirty']);
  assert.deepEqual(score(r, NOW, 2).reasons, ['1 dirty', 'stale-dirty 3d']);
});

test('score: gates ✗ (+4, aged in hours) vs gates stale (+2, aged in days)', () => {
  const base: Repo = { name: 'x', path: '/x', description: '', docs: [], feedback: null, git: null, sessions: { last: 0, count7d: 0 }, snuff: true, deadPaths: [], score: 0, reasons: [] };
  const red = score({ ...base, gates: { ok: false, red: ["lint"], passed: 1, total: 2, ts: NOW - 2 * 3_600_000 } }, NOW);
  assert.deepEqual(red.reasons, ['gates ✗ lint (2h)']);
  assert.equal(red.score, 4);
  const stale = score({ ...base, gates: { ok: true, red: [], passed: 2, total: 2, ts: NOW - 4 * 86_400_000 } }, NOW);
  assert.deepEqual(stale.reasons, ['gates stale 4d']);
  assert.equal(stale.score, 2);
  assert.deepEqual(score({ ...base, gates: undefined }, NOW).reasons, []);
});

test('gates: readSnuffLast reads ~/.snuff/<slug>.json, null when missing', () => {
  const home = mkdtempSync(join(tmpdir(), 'brief-snuff-'));
  const last = readSnuffLast('/Users/me/git/x', home);
  assert.equal(last, null);
  writeFileSync(join(home, '-Users-me-git-x.json'), JSON.stringify({ ts: NOW, ok: false, gates: [{ name: 'lint', ok: false, skipped: null }] }));
  assert.deepEqual(readSnuffLast('/Users/me/git/x', home), { ts: NOW, ok: false, gates: [{ name: 'lint', ok: false, skipped: null }] });
});

test('gates: readSnuffLast falls back to in-repo .snuff/last.json (ISO ts, nested gate.name)', () => {
  const home = mkdtempSync(join(tmpdir(), 'brief-snuff-'));
  const repo = mkdtempSync(join(tmpdir(), 'brief-repo-'));
  mkdirSync(join(repo, '.snuff'));
  writeFileSync(join(repo, '.snuff', 'last.json'), JSON.stringify({
    ts: '2026-08-16T12:00:00.000Z', head: 'abc', cwd: repo, ok: false,
    gates: [
      { gate: { name: 'lint', run: 'npm run lint' }, ok: false, skipped: 'no changes in paths', exitCode: null },
      { gate: { name: 'test', run: 'npm test' }, ok: false, skipped: null, exitCode: 1 },
      { gate: { name: 'build', run: 'npm run build' }, ok: true, skipped: null, exitCode: 0 },
    ],
  }));
  assert.deepEqual(readSnuffLast(repo, home), {
    ts: NOW, ok: false,
    gates: [{ name: 'lint', ok: false, skipped: 'no changes in paths' }, { name: 'test', ok: false, skipped: null }, { name: 'build', ok: true, skipped: null }],
  });
  // ~/.snuff/<slug>.json wins when present
  writeFileSync(join(home, `${slugFor(repo)}.json`), JSON.stringify({ ts: NOW - 1, ok: true, gates: [{ name: 'lint', ok: true, skipped: null }] }));
  assert.equal(readSnuffLast(repo, home)!.ts, NOW - 1);
});

test('docs: deadPaths flags backticked paths that do not resolve, ignores prose/commands', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  const dir = mkRepo(root, 'r', {
    'CLAUDE.md': 'see `src/x.ts` and `docs/gone.md`, run `npm test`\n',
    'src/x.ts': 'export {}\n',
  });
  const text = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
  assert.deepEqual(deadPaths(dir, text), ['docs/gone.md']);
  const repo = (await collectOne('r', dir, NOW, new Map()))!;
  assert.ok(repo.reasons.includes('CLAUDE.md: 1 dead paths'));
  assert.equal(repo.score, 1);
});

test('docs: deadPaths ignores CIDRs, regexes, URL paths, flags, product names, runtime json, nested files, live absolute paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  const home = mkdtempSync(join(tmpdir(), 'brief-home-'));
  const dir = mkRepo(root, 'r', {
    'tools/validate.py': '',
    'src/lib/db/filters.ts': '',
    'src/app/__tests__/a.test.ts': '',
    'node_modules/next/image.js': '',
    'CLAUDE.md': [
      '`192.168.2.0/24` `/DDP/i` `/admin` `--level/--grep` `Next.js` `state.json` `validate.py`',
      '`lib/db/filters.ts` `__tests__/` `next/image` `chore/description` `/tmp/looksy/`',
      `\`${root}/r/tools\` \`${root}/r/nope\` \`~/there\` \`~/not-there\``,
      '`./gone.sh` `research/missing.md` `docs/`',
    ].join('\n'),
  }, false);
  mkdirSync(join(home, 'there'));
  const text = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
  const dead = deadPaths(dir, text, home);
  // `${root}/r/nope` is only "dead" when it looks like a user path (/Users/, /home/) — tmp roots are transient
  assert.deepEqual(dead, ['~/not-there', './gone.sh', 'research/missing.md', 'docs/']);
  assert.deepEqual(deadPaths(dir, '`/Users/nobody/definitely/gone` `/Users/nobody/x`', home), ['/Users/nobody/definitely/gone', '/Users/nobody/x']);
});

test('render: --brief hook mode is 2 lines/repo, no fold/quiet lines, capped at 15', () => {
  const repos: Repo[] = Array.from({ length: 20 }, (_, i) => ({
    name: `r${i}`, path: `/r${i}`, description: '', docs: [], feedback: null, git: null,
    sessions: { last: NOW, count7d: 1 }, snuff: true, deadPaths: [], score: 20 - i, reasons: [`${20 - i} dirty`],
  }));
  const out = renderText({ root: [], now: NOW, repos }, { top: 3, all: false, brief: true });
  const lines = out.split('\n');
  assert.ok(lines.length <= 15);
  assert.ok(!lines.some((l) => l.startsWith('below the fold') || l.startsWith('quiet:')));
  assert.equal(lines.at(-1), '… +17 more, run brief');
  // --top 10 would need 21 lines: the cap trims repo lines, never the "+N more" tail
  const wide = renderText({ root: [], now: NOW, repos }, { top: 10, all: false, brief: true }).split('\n');
  assert.equal(wide.length, 15);
  assert.equal(wide.at(-1), '… +10 more, run brief');
});

test('runtime: service matches k8s:/cron:/site: findings, worst severity wins', () => {
  assert.equal(runtimeFor('app/svc-a', [{ id: 'k8s:app/svc-a', severity: 'crit' }]), 'crit');
  assert.equal(runtimeFor('app/svc-a', [{ id: 'k8s:other', severity: 'crit' }]), 'ok');
  assert.equal(runtimeFor('x', [{ id: 'cron:x', severity: 'warn' }, { id: 'site:x', severity: 'ok' }]), 'warn');
});

test('runtime: comma-separated service ids take the worst severity across all matches', () => {
  const findings = [
    { id: 'k8s:a/b', severity: 'ok' },
    { id: 'cron:a/c', severity: 'crit' },
  ];
  assert.equal(runtimeFor('a/b, a/c', findings), 'crit');
  assert.equal(runtimeFor('a/b', findings), 'ok');
  // trailing `*` matches by prefix, for repos that own a whole family of cron ids
  assert.equal(
    runtimeFor('worker-b/svc-1, worker-b/job-*', [
      { id: 'k8s:worker-b/svc-1', severity: 'ok' },
      { id: 'cron:worker-b/job-1', severity: 'warn' },
      { id: 'cron:worker-b/job-2', severity: 'crit' },
    ]),
    'crit',
  );
});

test('collect: .brief.yaml service: joins pulse last snapshot, scores runtime ✗', async () => {
  const pulseHome = mkdtempSync(join(tmpdir(), 'brief-pulse-'));
  mkdirSync(join(pulseHome, 'snaps'));
  writeFileSync(join(pulseHome, 'snaps', 'last.json'), JSON.stringify({ ts: NOW, findings: [{ id: 'k8s:app/svc-a', severity: 'crit' }] }));
  const prev = process.env.BRIEF_PULSE_HOME;
  process.env.BRIEF_PULSE_HOME = pulseHome;
  try {
    const root = mkdtempSync(join(tmpdir(), 'brief-'));
    const dir = mkRepo(root, 'r', { '.brief.yaml': 'service: app/svc-a\n' });
    const repo = (await collectOne('r', dir, NOW, new Map()))!;
    assert.equal(repo.runtime, 'crit');
    assert.ok(repo.reasons.includes('runtime ✗'));
    assert.equal(repo.score, 6);
  } finally {
    if (prev === undefined) delete process.env.BRIEF_PULSE_HOME;
    else process.env.BRIEF_PULSE_HOME = prev;
  }
});

test('collect: no pulse snapshot → runtime undefined, no tag', async () => {
  const pulseHome = mkdtempSync(join(tmpdir(), 'brief-pulse-empty-'));
  const prev = process.env.BRIEF_PULSE_HOME;
  process.env.BRIEF_PULSE_HOME = pulseHome;
  try {
    const root = mkdtempSync(join(tmpdir(), 'brief-'));
    const dir = mkRepo(root, 'r', { '.brief.yaml': 'service: app/svc-a\n' });
    const repo = (await collectOne('r', dir, NOW, new Map()))!;
    assert.equal(repo.runtime, undefined);
    assert.ok(!repo.reasons.some((x) => x.startsWith('runtime')));
  } finally {
    if (prev === undefined) delete process.env.BRIEF_PULSE_HOME;
    else process.env.BRIEF_PULSE_HOME = prev;
  }
});

test('PLAN progress: "PLAN d/total" tag on the radar, first open item as ↳ next fallback', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  const dir = mkRepo(root, 'r', {
    'PLAN.md': '# plan\n- [x] a\n- [x] b\n- [ ] c first\n- [ ] d\n- [ ] e\n',
  });
  const repo = (await collectOne('r', dir, NOW, new Map()))!;
  assert.equal(repo.docs[0].next[0], 'c first');
  const line = renderText({ root: [], now: NOW, repos: [repo] }, { top: 10, all: true });
  assert.match(line, /PLAN 2\/5/);
});

test('PLAN progress: STATE.md primary with no next borrows the first open PLAN.md item', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  const dir = mkRepo(root, 'r', {
    'STATE.md': '# state\nnothing here\n',
    'PLAN.md': '# plan\n- [ ] ship it\n',
  });
  const repo = (await collectOne('r', dir, NOW, new Map()))!;
  assert.equal(repo.docs[0].file, 'STATE.md');
  assert.equal(repo.docs[0].next[0], 'ship it');
  assert.equal(repo.docs[0].nextSource, 'PLAN.md');
});

test('sessions: lastAssistantText skips a trailing tool_use-only record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brief-'));
  const file = join(dir, 's.jsonl');
  const lines = [
    { type: 'user', message: { content: 'go' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Stopped at step 3; lint still red' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
  ];
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.equal(lastAssistantText(file), 'Stopped at step 3; lint still red');
  assert.deepEqual(lastAssistantTail(file), { text: 'Stopped at step 3; lint still red', turns: 1 });
  const repo: Repo = {
    name: 'r', path: '/r', description: '', docs: [], feedback: null, git: null,
    sessions: { last: NOW, count7d: 1 }, snuff: false, deadPaths: [], score: 0, reasons: [],
    lastSaid: { text: 'Stopped at step 3; lint still red', ts: NOW, turns: 4 },
  };
  assert.match(renderRepo(repo, NOW, { files: 10, commits: 3, next: 3 }), /last session said: Stopped at step 3.*\(1min, 4 turns\)/);
  assert.match(renderRepo({ ...repo, lastSaid: { text: 'x', ts: NOW } }, NOW, { files: 10, commits: 3, next: 3 }), /last session said: x \(1min\)/);
  const noText = mkdtempSync(join(tmpdir(), 'brief-'));
  const emptyFile = join(noText, 's.jsonl');
  writeFileSync(emptyFile, JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n');
  assert.equal(lastAssistantText(emptyFile), null);
});

test('docs: nextItem finds the first open item, skips "- [ ] done", folds continuation lines', () => {
  const text = '# plan\n\n- [x] a\n- [x] b\n\n## Phase\n- [ ] ship it\n  continuation detail\n- [ ] later\n';
  const item = nextItem(text)!;
  assert.equal(item.line, 7);
  assert.match(item.text, /continuation detail/);
  assert.equal(nextItem('# plan\n- [ ] done\n- [ ] real work\n')!.text, '- [ ] real work');
  assert.equal(nextItem('# plan\n- [x] a\n'), null);
  assert.equal(nextItem(''), null);
});

test('queue: lists only repos whose PLAN carries the agent marker, --json[0].open matches', () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  const a = mkRepo(root, 'a', { 'PLAN.md': '# a\n\n> How to run this plan (agent): read CLAUDE.md first…\n\n- [x] done1\n- [ ] one\n- [ ] two\n' });
  const b = mkRepo(root, 'b', { 'TODO.md': '- [ ] just a todo\n' });
  const rows = buildQueue([{ name: 'a', path: a }, { name: 'b', path: b }]);
  assert.deepEqual(rows.map((r) => r.repo), ['a']);
  assert.equal(rows[0].open, 2);
  assert.match(renderQueue(rows), /^a  PLAN 1\/3  ↳ one/);
});

test('git: unpushedSince from the oldest unpushed commit; score/radar show the age', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-'));
  const bare = join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '-q', bare]);
  const dir = mkRepo(root, 'r', { 'README.md': 'r' });
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: dir });
  execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: dir });
  const commitDate = new Date(NOW - 4 * 86_400_000).toISOString();
  writeFileSync(join(dir, 'README.md'), 'r2');
  execFileSync('git', ['commit', '-qam', 'unpushed change'], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: commitDate, GIT_COMMITTER_DATE: commitDate } });
  const g = (await gitInfo(dir))!;
  assert.equal(g.ahead, 1);
  assert.equal(g.unpushedSince, Date.parse(commitDate));
  const repo: Repo = {
    name: 'r', path: dir, description: '', docs: [], feedback: null, git: g,
    sessions: { last: 0, count7d: 0 }, snuff: false, deadPaths: [], score: 0, reasons: [],
  };
  const s = score(repo, NOW);
  assert.ok(s.reasons.includes('unpushed 4d'));
  const line = renderText({ root: [], now: NOW, repos: [{ ...repo, score: s.score, reasons: s.reasons }] }, { top: 10, all: true });
  assert.match(line, /1 unpushed \(4d\)/);
});

test('snap: diffSnaps buckets new/gone/changed/unchanged, renderDiff summarizes', () => {
  const snapWith = (scores: Record<string, number>) => ({ ts: NOW, repos: Object.entries(scores).map(([name, score]) => ({ name, score, reasons: [`${score}`], dirty: 0, ahead: 0, lastCommitTs: 0, next: '' })) });
  const d = diffSnaps(snapWith({ x: 5, y: 1 }), snapWith({ x: 12, z: 3 }));
  assert.deepEqual(d.new, ['z']);
  assert.deepEqual(d.gone, ['y']);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].name, 'x');
  assert.equal(d.changed[0].from, 5);
  assert.equal(d.changed[0].to, 12);
  assert.equal(d.unchanged, 0);
  const text = renderDiff(d, NOW - 3 * 86_400_000, NOW);
  assert.match(text.split('\n')[0], /1 new · 1 gone · 1 changed/);
});

test('cli: --brief defaults top to 3, --top overrides', () => {
  const home = '/home/t';
  assert.equal(parseArgs(['--brief'], home).top, 3);
  assert.equal(parseArgs(['--brief', '--top', '5'], home).top, 5);
});
