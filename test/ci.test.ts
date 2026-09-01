// New signal: GitHub Actions state per repo (motivation: a public repo sat with a red
// Actions run for two days and nothing in the radar surfaced it). See src/ci.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ciState, CI_TTL_MS } from '../src/ci.js';
import { score, CI_FAIL_WEIGHT } from '../src/score.js';
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

/** Fake an upstream-tracking branch without a real remote fetch, so `@{u}` resolves locally. */
function setUpstream(dir: string, sha: string): void {
  git(dir, 'update-ref', 'refs/remotes/origin/main', sha);
  git(dir, 'branch', '--set-upstream-to=origin/main', 'main');
}

test('ci: repo without workflows -> none, exec never called', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-ci-'));
  const home = mkdtempSync(join(tmpdir(), 'brief-home-'));
  const dir = mkRepo(root, 'plain', { remote: 'git@github.com:acme/plain.git' });
  let calls = 0;
  const exec = () => {
    calls++;
    return '[]';
  };
  const r = await ciState(dir, { home, now: NOW, exec });
  assert.deepEqual(r, { state: 'none', reason: 'no-workflow', checkedAt: NOW });
  assert.equal(calls, 0);
});

test('ci: workflow present but remote is not github -> none, exec never called', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-ci-'));
  const home = mkdtempSync(join(tmpdir(), 'brief-home-'));
  const dir = mkRepo(root, 'x', { workflow: true, remote: 'git@gitlab.com:acme/x.git' });
  let calls = 0;
  const exec = () => {
    calls++;
    return '[]';
  };
  const r = await ciState(dir, { home, now: NOW, exec });
  assert.equal(r.state, 'none');
  assert.equal(calls, 0);
});

test('ci: successful run -> pass, cached under $BRIEF_HOME/ci.json', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-ci-'));
  const home = mkdtempSync(join(tmpdir(), 'brief-home-'));
  const dir = mkRepo(root, 'x', { workflow: true, remote: 'git@github.com:acme/x.git' });
  const sha = headSha(dir);
  setUpstream(dir, sha);
  const exec = (args: string[]) => {
    assert.deepEqual(args, ['run', 'list', '-R', 'acme/x', '--branch', 'main', '--limit', '1', '--json', 'conclusion,status,headSha,workflowName']);
    return JSON.stringify([{ conclusion: 'success', status: 'completed', headSha: sha, workflowName: 'CI' }]);
  };
  const r = await ciState(dir, { home, now: NOW, exec });
  assert.deepEqual(r, { state: 'pass', sha, workflow: 'CI', checkedAt: NOW });
  const cache = JSON.parse(readFileSync(join(home, 'ci.json'), 'utf8'));
  assert.equal(cache[dir].state, 'pass');
  assert.equal(cache[dir].keySha, sha);
});

test('ci: cached entry reused within TTL when upstream sha unchanged, re-probed once it changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-ci-'));
  const home = mkdtempSync(join(tmpdir(), 'brief-home-'));
  const dir = mkRepo(root, 'x', { workflow: true, remote: 'git@github.com:acme/x.git' });
  const sha1 = headSha(dir);
  setUpstream(dir, sha1);
  let calls = 0;
  const exec1 = () => {
    calls++;
    return JSON.stringify([{ conclusion: 'success', status: 'completed', headSha: sha1, workflowName: 'CI' }]);
  };
  const first = await ciState(dir, { home, now: NOW, exec: exec1 });
  assert.equal(first.state, 'pass');
  assert.equal(calls, 1);

  // within TTL, same upstream sha -> cache reused, exec not called again
  const again = await ciState(dir, { home, now: NOW + CI_TTL_MS - 1, exec: exec1 });
  assert.equal(calls, 1);
  assert.deepEqual(again, first);

  // upstream moves -> re-probed even though still within TTL
  writeFileSync(join(dir, 'a.txt'), 'x');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'c2');
  const sha2 = headSha(dir);
  setUpstream(dir, sha2);
  const exec2 = () => {
    calls++;
    return JSON.stringify([{ conclusion: 'failure', status: 'completed', headSha: sha2, workflowName: 'CI' }]);
  };
  const changed = await ciState(dir, { home, now: NOW + CI_TTL_MS - 1, exec: exec2 });
  assert.equal(calls, 2);
  assert.equal(changed.state, 'fail');
});

test('ci: exec throwing -> unknown, never throws, and is not cached', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-ci-'));
  const home = mkdtempSync(join(tmpdir(), 'brief-home-'));
  const dir = mkRepo(root, 'x', { workflow: true, remote: 'git@github.com:acme/x.git' });
  const exec = () => {
    throw new Error('gh: not found');
  };
  const r = await ciState(dir, { home, now: NOW, exec });
  assert.deepEqual(r, { state: 'unknown', reason: 'no-gh', checkedAt: NOW });
  let entryAbsent = true;
  try {
    const cache = JSON.parse(readFileSync(join(home, 'ci.json'), 'utf8'));
    entryAbsent = cache[dir] === undefined;
  } catch {
    entryAbsent = true; // no cache file written at all is also fine
  }
  assert.ok(entryAbsent);
});

test('ci: --no-ci opt / BRIEF_NO_CI env skip probing entirely, exec never called', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brief-ci-'));
  const home = mkdtempSync(join(tmpdir(), 'brief-home-'));
  const dir = mkRepo(root, 'x', { workflow: true, remote: 'git@github.com:acme/x.git' });
  let calls = 0;
  const exec = () => {
    calls++;
    return '[]';
  };
  const viaOpt = await ciState(dir, { home, now: NOW, exec, noCi: true });
  assert.deepEqual(viaOpt, { state: 'none', reason: 'disabled', checkedAt: NOW });
  assert.equal(calls, 0);

  process.env.BRIEF_NO_CI = '1';
  try {
    const viaEnv = await ciState(dir, { home, now: NOW, exec });
    assert.deepEqual(viaEnv, { state: 'none', reason: 'disabled', checkedAt: NOW });
    assert.equal(calls, 0);
  } finally {
    delete process.env.BRIEF_NO_CI;
  }
});

test('score + render: red CI adds CI_FAIL_WEIGHT (same as unpushed base) and renders "ci ✗ <workflow> @<sha7>"', () => {
  const base: Repo = {
    name: 'x', path: '/x', description: '', docs: [], feedback: null, git: null,
    sessions: { last: NOW, count7d: 1 }, snuff: true, deadPaths: [], score: 0, reasons: [],
  };
  const pass: Repo = { ...base, ci: { state: 'pass', checkedAt: NOW } };
  const fail: Repo = { ...base, ci: { state: 'fail', sha: 'abcdef1234567', workflow: 'CI', checkedAt: NOW } };
  const sPass = score(pass, NOW);
  const sFail = score(fail, NOW);
  assert.equal(sFail.score - sPass.score, CI_FAIL_WEIGHT);
  assert.ok(sFail.reasons.includes('ci ✗'));
  assert.ok(!sPass.reasons.includes('ci ✗'));

  const repo: Repo = { ...fail, score: sFail.score, reasons: sFail.reasons };
  const text = renderText({ root: ['/r'], now: NOW, findings: [], repos: [repo] }, { top: 10, all: true });
  assert.match(text, /ci ✗/);
  assert.match(text, /ci ✗ CI @abcdef1/);
  assert.match(text, /1 red CI/);
});

test('render: "gh unavailable" trailing line appears exactly once when a probed repo comes back unknown with no run data', () => {
  const okRepo: Repo = {
    name: 'ok', path: '/ok', description: '', docs: [], feedback: null, git: null,
    sessions: { last: NOW, count7d: 1 }, snuff: true, deadPaths: [], score: 1, reasons: ['x'],
    ci: { state: 'pass', checkedAt: NOW },
  };
  const unknownRepo: Repo = {
    name: 'unk', path: '/unk', description: '', docs: [], feedback: null, git: null,
    sessions: { last: NOW, count7d: 1 }, snuff: true, deadPaths: [], score: 1, reasons: ['y'],
    ci: { state: 'unknown', reason: 'no-gh', checkedAt: NOW },
  };
  const text = renderText({ root: ['/r'], now: NOW, findings: [], repos: [okRepo, unknownRepo] }, { top: 10, all: true });
  assert.match(text, /ci: gh unavailable — install\/auth gh or pass --no-ci/);
  assert.equal(text.match(/gh unavailable/g)?.length, 1);
  const clean = renderText({ root: ['/r'], now: NOW, findings: [], repos: [okRepo] }, { top: 10, all: true });
  assert.doesNotMatch(clean, /gh unavailable/);
});
