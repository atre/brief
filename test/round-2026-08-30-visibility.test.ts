// Acceptance tests for plans/2026-08-30-feedback-round.md, step 3 (repo visibility). This file
// does not compile until src/visibility.ts exists — see the plan's Acceptance section.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachVisibility, githubSlug, VISIBILITY_TTL_MS } from '../src/visibility.js';
import { renderFeedback } from '../src/render.js';
import { parseArgs } from '../src/cli.js';
import type { Repo } from '../src/types.js';

const NOW = Date.parse('2026-08-30T12:00:00Z');
const mk = (path: string): Repo => ({ name: path.slice(3), path } as unknown as Repo);

test('visibility: githubSlug parses ssh/https github remotes, null otherwise', () => {
  assert.equal(githubSlug('git@github.com:atre/brief.git'), 'atre/brief');
  assert.equal(githubSlug('https://github.com/atre/brief.git'), 'atre/brief');
  assert.equal(githubSlug('https://github.com/atre/brief'), 'atre/brief');
  assert.equal(githubSlug('git@gitlab.com:x/y.git'), null);
  assert.equal(githubSlug(''), null);
});

test('visibility: attachVisibility probes github remotes once, caches under BRIEF_HOME, honours TTL/refresh, never throws', async () => {
  const home = mkdtempSync(join(tmpdir(), 'brief-home-'));
  const repos = [mk('/r/pub'), mk('/r/priv'), mk('/r/local'), mk('/r/broken')];
  const remotes: Record<string, string> = {
    '/r/pub': 'git@github.com:o/pub.git',
    '/r/priv': 'https://github.com/o/priv.git',
    '/r/local': '',
    '/r/broken': 'git@github.com:o/broken.git',
  };
  const calls: string[] = [];
  const probe = async (slug: string): Promise<string> => {
    calls.push(slug);
    if (slug === 'o/broken') throw new Error('gh: not logged in');
    return slug === 'o/pub' ? 'PUBLIC' : 'PRIVATE';
  };
  const remote = async (p: string): Promise<string> => remotes[p];

  await attachVisibility(repos, { home, now: NOW, probe, remote });
  assert.deepEqual(repos.map((r) => r.visibility), ['public', 'private', 'local', 'unknown']);
  assert.deepEqual([...calls].sort(), ['o/broken', 'o/priv', 'o/pub']);
  const cache = JSON.parse(readFileSync(join(home, 'visibility.json'), 'utf8'));
  assert.deepEqual(cache['/r/pub'], { visibility: 'public', checkedAt: NOW });
  assert.equal(cache['/r/broken'], undefined); // unknown is never cached — retried next run

  // cache hit inside the TTL: only the uncached (unknown) repo is probed again
  calls.length = 0;
  await attachVisibility(repos, { home, now: NOW + VISIBILITY_TTL_MS - 1, probe, remote });
  assert.deepEqual(calls, ['o/broken']);
  assert.equal(repos[0].visibility, 'public');

  // past the TTL → probed again
  calls.length = 0;
  await attachVisibility(repos, { home, now: NOW + VISIBILITY_TTL_MS + 1, probe, remote });
  assert.ok(calls.includes('o/pub') && calls.includes('o/priv'));

  // fresh cache but refresh: true → probed again
  calls.length = 0;
  await attachVisibility(repos, { home, now: NOW + VISIBILITY_TTL_MS + 2, probe, remote, refresh: true });
  assert.ok(calls.includes('o/pub'));
});

test('cli: --public / --private / --refresh-visibility parse, and only with feedback', () => {
  const a = parseArgs(['feedback', '--public'], '/h') as unknown as Record<string, unknown>;
  assert.equal(a.cmd, 'feedback');
  assert.equal(a.visibility, 'public');
  const b = parseArgs(['feedback', '--private', '--refresh-visibility'], '/h') as unknown as Record<string, unknown>;
  assert.equal(b.visibility, 'private');
  assert.equal(b.refreshVisibility, true);
  assert.throws(() => parseArgs(['--public'], '/h'), /only valid with `brief feedback`/);
  assert.throws(() => parseArgs(['feedback', '--public', '--private'], '/h'), /one of/);
});

test('feedback: repo line carries a [public]/[private]/[local] tag; unknown carries none', () => {
  const item = { header: '2026-08-20 — a', ts: Date.parse('2026-08-20'), preview: 'p' };
  const fbk = (path: string, visibility: string): Repo =>
    ({ name: path.slice(3), path, visibility, feedback: { sections: 1, untriaged: [item.header], items: [item], lessons: [] } } as unknown as Repo);
  const out = renderFeedback({ root: ['/r'], now: NOW, repos: [fbk('/r/x', 'public'), fbk('/r/y', 'private'), fbk('/r/z', 'local')] });
  assert.match(out, /^x \(1\) \[public\] — \/r\/x\/FEEDBACK\.md$/m);
  assert.match(out, /^y \(1\) \[private\] — \/r\/y\/FEEDBACK\.md$/m);
  assert.match(out, /^z \(1\) \[local\] — \/r\/z\/FEEDBACK\.md$/m);
});
