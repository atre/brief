// Feedback round 2026-08-30 #2 (FEEDBACK.md "ci signal" surprises): the CI cache key
// falls back to HEAD when the branch has no upstream, and "gh unavailable" is an explicit
// `reason` on CiResult instead of the implicit `unknown && !sha` contract.
// See plans/2026-08-30-feedback-round-2.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ciState, CI_TTL_MS } from '../src/ci.js';
import { renderText } from '../src/render.js';
import type { Repo } from '../src/types.js';

const NOW = Date.parse('2026-08-30T12:00:00Z');
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' });

function mkRepo(root: string, name: string, opts: { workflow?: boolean; remote?: string } = {}): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  if (opts.workflow) {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\non: push\n');
  }
  writeFileSync(join(dir, 'README.md'), name);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  if (opts.remote) git(dir, 'remote', 'add', 'origin', opts.remote);
  return dir;
}

const headSha = (dir: string): string => git(dir, 'rev-parse', 'HEAD').trim();

function setUpstream(dir: string, sha: string): void {
  git(dir, 'update-ref', 'refs/remotes/origin/main', sha);
  git(dir, 'branch', '--set-upstream-to=origin/main', 'main');
}

const passRun = (sha: string) => JSON.stringify([{ conclusion: 'success', status: 'completed', headSha: sha, workflowName: 'CI' }]);

test('ci cache: no upstream -> keyed by HEAD (keyFrom head): reused within TTL, re-probed after a new local commit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-ci2-'));
  const home = mkdtempSync(join(tmpdir(), 'brief-home2-'));
  const dir = mkRepo(root, 'x', { workflow: true, remote: 'git@github.com:acme/x.git' });
  // no setUpstream: `git rev-parse @{u}` is empty for this repo
  const sha1 = headSha(dir);
  let calls = 0;
  const exec = () => {
    calls++;
    return passRun(sha1);
  };
  const first = await ciState(dir, { home, now: NOW, exec });
  assert.equal(first.state, 'pass');
  assert.equal(calls, 1);
  const cache = JSON.parse(readFileSync(join(home, 'ci.json'), 'utf8'));
  assert.equal(cache[dir].keyFrom, 'head');
  assert.equal(cache[dir].keySha, sha1);

  const again = await ciState(dir, { home, now: NOW + CI_TTL_MS - 1, exec });
  assert.equal(calls, 1);
  assert.deepEqual(again, first);

  writeFileSync(join(dir, 'a.txt'), 'x');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c2');
  const r2 = await ciState(dir, { home, now: NOW + CI_TTL_MS - 1, exec });
  assert.equal(calls, 2, 'new HEAD must invalidate the cache even within the TTL');
  assert.equal(r2.state, 'pass');
  const cache2 = JSON.parse(readFileSync(join(home, 'ci.json'), 'utf8'));
  assert.equal(cache2[dir].keySha, headSha(dir));
});

test('ci cache: with upstream -> keyed by the upstream sha (keyFrom upstream), a local-only commit does not re-probe', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-ci2-'));
  const home = mkdtempSync(join(tmpdir(), 'brief-home2-'));
  const dir = mkRepo(root, 'x', { workflow: true, remote: 'git@github.com:acme/x.git' });
  const sha1 = headSha(dir);
  setUpstream(dir, sha1);
  let calls = 0;
  const exec = () => {
    calls++;
    return passRun(sha1);
  };
  await ciState(dir, { home, now: NOW, exec });
  const cache = JSON.parse(readFileSync(join(home, 'ci.json'), 'utf8'));
  assert.equal(cache[dir].keyFrom, 'upstream');
  assert.equal(cache[dir].keySha, sha1);

  // local commit ahead of upstream: upstream sha unchanged -> still a cache hit
  writeFileSync(join(dir, 'a.txt'), 'x');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c2');
  await ciState(dir, { home, now: NOW + 1000, exec });
  assert.equal(calls, 1);
});

test('ci reason: every non-probed / unknown outcome carries an explicit reason', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-ci2-'));
  const home = mkdtempSync(join(tmpdir(), 'brief-home2-'));
  const plain = mkRepo(root, 'plain', { remote: 'git@github.com:acme/plain.git' });
  const gitlab = mkRepo(root, 'gl', { workflow: true, remote: 'git@gitlab.com:acme/gl.git' });
  const gh = mkRepo(root, 'gh', { workflow: true, remote: 'git@github.com:acme/gh.git' });
  const sha = headSha(gh);

  assert.deepEqual(await ciState(plain, { home, now: NOW, exec: () => '[]' }), { state: 'none', reason: 'no-workflow', checkedAt: NOW });
  assert.deepEqual(await ciState(gitlab, { home, now: NOW, exec: () => '[]' }), { state: 'none', reason: 'no-remote', checkedAt: NOW });
  assert.deepEqual(await ciState(gh, { home, now: NOW, exec: () => '[]', noCi: true }), { state: 'none', reason: 'disabled', checkedAt: NOW });

  // the three 'unknown' outcomes first — none of them is cached, so `gh` stays uncached below
  const inProgress = await ciState(gh, {
    home, now: NOW,
    exec: () => JSON.stringify([{ conclusion: null, status: 'in_progress', headSha: sha, workflowName: 'CI' }]),
  });
  assert.deepEqual(inProgress, { state: 'unknown', reason: 'in-progress', sha, workflow: 'CI', checkedAt: NOW });

  const skipped = await ciState(gh, {
    home, now: NOW,
    exec: () => JSON.stringify([{ conclusion: 'skipped', status: 'completed', headSha: sha, workflowName: 'CI' }]),
  });
  assert.deepEqual(skipped, { state: 'unknown', reason: 'unrecognized', sha, workflow: 'CI', checkedAt: NOW });

  const noGh = await ciState(gh, {
    home, now: NOW,
    exec: () => {
      throw new Error('gh: not found');
    },
  });
  assert.deepEqual(noGh, { state: 'unknown', reason: 'no-gh', checkedAt: NOW });

  assert.deepEqual(await ciState(gh, { home, now: NOW, exec: () => '[]' }), { state: 'none', reason: 'no-runs', checkedAt: NOW });

  // a probed pass/fail carries no reason key at all (refresh: the 'no-runs' result above is cached)
  const ok = await ciState(gh, { home, now: NOW, refresh: true, exec: () => passRun(sha) });
  assert.deepEqual(ok, { state: 'pass', sha, workflow: 'CI', checkedAt: NOW });
  assert.ok(!('reason' in ok));
});

test('render: the "gh unavailable" line keys on reason === no-gh, not on a missing sha', () => {
  const base: Repo = {
    name: 'x', path: '/x', description: '', docs: [], feedback: null, git: null,
    sessions: { last: NOW, count7d: 1 }, snuff: true, deadPaths: [], score: 1, reasons: ['y'],
  };
  const inProgressNoSha: Repo = { ...base, ci: { state: 'unknown', reason: 'in-progress', checkedAt: NOW } };
  const noGh: Repo = { ...base, name: 'z', path: '/z', ci: { state: 'unknown', reason: 'no-gh', checkedAt: NOW } };

  const quiet = renderText({ root: ['/r'], now: NOW, findings: [], repos: [inProgressNoSha] }, { top: 10, all: true });
  assert.doesNotMatch(quiet, /gh unavailable/);

  const loud = renderText({ root: ['/r'], now: NOW, findings: [], repos: [inProgressNoSha, noGh] }, { top: 10, all: true });
  assert.match(loud, /ci: gh unavailable — install\/auth gh or pass --no-ci/);
  assert.equal(loud.match(/gh unavailable/g)?.length, 1);
});
