import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { discover } from './discover.js';
import { gitInfo } from './git.js';
import { describe, docInfos, feedbackInfo, extractNext, readIf, deadPaths } from './docs.js';
import { indexSessions, sessionsFor, newestTranscript, lastAssistantTail } from './sessions.js';
import { score } from './score.js';
import { readConfig } from './config.js';
import { readTally, attachTokens } from './tokens.js';
import { readSnuffLast } from './gates.js';
import { readPulseLast, runtimeFor } from './runtime.js';
import type { Repo, Report } from './types.js';

type GateResult = { name: string; ok: boolean; skipped: string | null };
function gateSummary(ok: boolean, gates: GateResult[], ts?: number): NonNullable<Repo['gates']> {
  const ran = gates.filter((g) => !g.skipped);
  return { ok, red: ran.filter((g) => !g.ok).map((g) => g.name), passed: ran.filter((g) => g.ok).length, total: ran.length, ts };
}

const execFileAsync = promisify(execFile);

export type GateRunner = (cwd: string) => Promise<{ ok: boolean; gates: { name: string; ok: boolean; skipped: string | null }[] } | null>;

export const runSnuff: GateRunner = async (cwd) => {
  try {
    const { stdout } = await execFileAsync('snuff', ['--json', '--changed'], { cwd, timeout: 60_000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
};

export interface CollectOpts {
  roots: string[];
  docsRoots?: string[];
  exclude: string[];
  now: number;
  only?: string; // substring filter on name
  concurrency?: number;
  staleDays?: number;
}

export async function collectOne(
  name: string,
  path: string,
  now: number,
  sessionsIdx = indexSessions(now),
  staleDays = 7,
  opts: { gates?: GateRunner; lastSaid?: boolean } = {},
): Promise<Repo | null> {
  const cfg = readConfig(path);
  if (cfg.ignore) return null;
  const git = await gitInfo(path);
  const docs = await docInfos(path, git !== null, cfg);
  const claudeMd = readIf(join(path, 'CLAUDE.md'));
  // no next in the state doc → borrow the first open PLAN.md item, else CLAUDE.md checkboxes
  if (docs[0] && !docs[0].next.length) {
    const planDoc = docs[0].file.toLowerCase() !== 'plan.md' ? docs.find((d) => d.file.toLowerCase() === 'plan.md') : undefined;
    if (planDoc?.next.length) {
      docs[0].next = [planDoc.next[0]];
      docs[0].nextSource = 'PLAN.md';
    } else {
      const alt = claudeMd ? extractNext(claudeMd, 5, false) : null; // checkboxes only — prose bullets aren't tasks
      if (alt?.next.length) {
        docs[0].next = alt.next;
        docs[0].nextSource = 'CLAUDE.md';
      }
    }
  }
  const planMtime = docs.find((d) => d.file.toLowerCase() === 'plan.md')?.mtime ?? docs[0]?.mtime ?? 0;
  const repo: Repo = {
    name,
    path,
    description: cfg.description ?? describe(path),
    git,
    docs,
    feedback: feedbackInfo(path, planMtime),
    sessions: sessionsFor(sessionsIdx, path),
    snuff: existsSync(join(path, 'snuff.yaml')),
    deadPaths: claudeMd ? deadPaths(path, claudeMd) : [],
    score: 0,
    reasons: [],
  };
  if (cfg.service) {
    const pulse = readPulseLast();
    if (pulse) repo.runtime = runtimeFor(cfg.service, pulse.findings);
  }
  if (opts.lastSaid) {
    const transcript = newestTranscript(path);
    const tail = transcript && lastAssistantTail(transcript.file);
    if (tail) repo.lastSaid = { text: tail.text.replace(/\s+/g, ' ').trim().slice(0, 300), ts: transcript!.ts, ...(tail.turns !== null ? { turns: tail.turns } : {}) };
  }
  if (opts.gates) {
    const result = await opts.gates(path);
    repo.gates = result ? gateSummary(result.ok, result.gates, now) : null;
  } else {
    const last = readSnuffLast(path);
    if (last) repo.gates = gateSummary(last.ok, last.gates, last.ts);
  }
  const sc = score(repo, now, staleDays);
  repo.score = sc.score;
  repo.reasons = sc.reasons;
  return repo;
}

export async function collect(opts: CollectOpts): Promise<Report> {
  const cands = discover(opts.roots, opts.exclude, opts.docsRoots).filter((c) => !opts.only || c.name.includes(opts.only));
  const idx = indexSessions(opts.now);
  const limit = opts.concurrency ?? 8;
  const repos: (Repo | null)[] = new Array(cands.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, cands.length) }, async () => {
      while (i < cands.length) {
        const k = i++;
        repos[k] = await collectOne(cands[k].name, cands[k].path, opts.now, idx, opts.staleDays);
      }
    }),
  );
  const live = repos.filter((r): r is Repo => r !== null);
  attachTokens(live, await readTally(), homedir());
  return { root: opts.roots, now: opts.now, repos: live };
}
