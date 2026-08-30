// Feedback round 2026-08-30 #2 (FEEDBACK.md "public-repo FEEDBACK sweep → 7 gameplans, round 2"):
// `brief feedback --headers` drops the preview lines, and repos with no GitHub remote render `[local]`.
// See plans/2026-08-30-feedback-round-2.md steps 3-4.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli.js';
import { renderFeedback } from '../src/render.js';
import type { Repo, Report } from '../src/types.js';

const NOW = Date.parse('2026-08-30T12:00:00Z');
// cast: the second argument does not exist until step 4 — keeps this file compiling today
const render = renderFeedback as unknown as (rep: Report, opts?: { headers?: boolean }) => string;

const item = (header: string, preview = 'p') => ({ header, ts: Date.parse(header.slice(0, 10)), preview });
const fbk = (path: string, visibility: string | undefined, items: ReturnType<typeof item>[]): Repo =>
  ({
    name: path.slice(3),
    path,
    visibility,
    feedback: { sections: items.length, untriaged: items.map((i) => i.header), items, lessons: [] },
  }) as unknown as Repo;

test('feedback: [local] tag for repos with no GitHub remote / not git; unknown and never-probed stay untagged', () => {
  const rep: Report = {
    root: ['/r'],
    now: NOW,
    repos: [
      fbk('/r/x', 'public', [item('2026-08-20 — a')]),
      fbk('/r/y', 'private', [item('2026-08-20 — b')]),
      fbk('/r/z', 'local', [item('2026-08-20 — c')]),
      fbk('/r/w', 'unknown', [item('2026-08-20 — d')]),
      fbk('/r/v', undefined, [item('2026-08-20 — e')]),
    ],
  };
  const out = render(rep);
  assert.match(out, /^x \(1\) \[public\] — \/r\/x\/FEEDBACK\.md$/m);
  assert.match(out, /^y \(1\) \[private\] — \/r\/y\/FEEDBACK\.md$/m);
  assert.match(out, /^z \(1\) \[local\] — \/r\/z\/FEEDBACK\.md$/m);
  assert.match(out, /^w \(1\) — \/r\/w\/FEEDBACK\.md$/m);
  assert.match(out, /^v \(1\) — \/r\/v\/FEEDBACK\.md$/m);
  assert.equal(out.match(/\[local\]/g)?.length, 1);
});

test('cli: --headers parses for `brief feedback` (composes with --only) and is rejected elsewhere', () => {
  const a = parseArgs(['feedback', '--headers'], '/h') as unknown as Record<string, unknown>;
  assert.equal(a.cmd, 'feedback');
  assert.equal(a.headers, true);
  const b = parseArgs(['feedback', '--headers', '--only', 'brief'], '/h') as unknown as Record<string, unknown>;
  assert.equal(b.headers, true);
  assert.equal(b.only, 'brief');
  const c = parseArgs(['feedback'], '/h') as unknown as Record<string, unknown>;
  assert.equal(c.headers, false);
  assert.throws(() => parseArgs(['--headers'], '/h'), /--headers is only valid for `brief feedback`/);
});

test('feedback --headers: repo lines + section headers only, no preview lines; default output unchanged', () => {
  const rep: Report = {
    root: ['/r'],
    now: NOW,
    repos: [
      fbk('/r/y', 'private', [item('2026-08-20 — c', 'preview c')]),
      fbk('/r/x', 'public', [item('2026-08-20 — a', 'preview a'), item('2026-08-21 — b', 'preview b')]),
    ],
  };
  const headers = render(rep, { headers: true }).split('\n');
  assert.deepEqual(headers, [
    'feedback — 3 untriaged sections in 2 repos (after each repo\'s last "## <date> — triage" marker)',
    'x (2) [public] — /r/x/FEEDBACK.md',
    '  · 2026-08-20 — a',
    '  · 2026-08-21 — b',
    'y (1) [private] — /r/y/FEEDBACK.md',
    '  · 2026-08-20 — c',
  ]);

  const full = render(rep).split('\n');
  assert.equal(full.length, headers.length + 3, 'default output keeps one preview line per section');
  assert.deepEqual(full.filter((l) => l.startsWith('      ')), ['      preview a', '      preview b', '      preview c']);
  assert.deepEqual(render(rep, {}).split('\n'), full, 'empty opts = default');
});
