import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.js';
import { githubSlug, briefHome } from './visibility.js';

// Motivation: brief ranks repos by dirty/unpushed/stale docs but not by CI state — a
// public repo sat with a red GitHub Actions run for two days and nothing surfaced it
// in the SessionStart radar. This probes the current branch's latest Actions run.

export type CiState = 'pass' | 'fail' | 'none' | 'unknown';

export type CiReason = 'disabled' | 'no-workflow' | 'no-remote' | 'no-runs' | 'in-progress' | 'unrecognized' | 'no-gh';

export interface CiResult {
  state: CiState;
  reason?: CiReason; // why state is 'none' | 'unknown'; absent on a probed pass/fail
  sha?: string;
  workflow?: string;
  checkedAt: number;
}

export const CI_TTL_MS = 60 * 60_000;

interface CiCacheEntry extends CiResult {
  keySha: string;
  keyFrom: 'upstream' | 'head';
}

const FAIL_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure']);

function hasWorkflowFiles(repoPath: string): boolean {
  try {
    return readdirSync(join(repoPath, '.github', 'workflows')).some((f) => /\.ya?ml$/i.test(f));
  } catch {
    return false;
  }
}

function defaultExec(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', timeout: 5_000 });
}

export interface CiOpts {
  home?: string;
  now?: number;
  refresh?: boolean;
  noCi?: boolean;
  exec?: (args: string[]) => string;
}

/**
 * CI state for one repo's current branch: latest GitHub Actions run via `gh run list`.
 * Gated cheaply — only probes when the repo has a workflow file AND a github.com remote;
 * otherwise 'none' with no `gh` call. Cached 1h in `$BRIEF_HOME/ci.json`, keyed by the
 * upstream (`@{u}`) sha — or by HEAD when the branch has no upstream — so a re-probe only happens
 * after new commits land (upstream, or locally on an untracked branch).
 * Never throws — gh missing/unauthenticated/network errors resolve to 'unknown'.
 */
export async function ciState(repoPath: string, opts: CiOpts = {}): Promise<CiResult> {
  const now = opts.now ?? Date.now();
  const noCi = !!opts.noCi || process.env.BRIEF_NO_CI === '1';
  if (noCi) return { state: 'none', reason: 'disabled', checkedAt: now };

  if (!hasWorkflowFiles(repoPath)) return { state: 'none', reason: 'no-workflow', checkedAt: now };
  const remoteUrl = await git(repoPath, ['remote', 'get-url', 'origin']);
  const slug = githubSlug(remoteUrl);
  if (!slug) return { state: 'none', reason: 'no-remote', checkedAt: now };

  const home = opts.home ?? briefHome();
  const cacheFile = join(home, 'ci.json');
  let cache: Record<string, CiCacheEntry> = {};
  try {
    cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {
    cache = {};
  }
  const cached = cache[repoPath];
  const upstreamSha = (await git(repoPath, ['rev-parse', '@{u}'])).trim();
  const keyFrom: 'upstream' | 'head' = upstreamSha ? 'upstream' : 'head';
  const keySha = upstreamSha || (await git(repoPath, ['rev-parse', 'HEAD'])).trim();

  if (!opts.refresh && cached && cached.keySha === keySha && now - cached.checkedAt < CI_TTL_MS) {
    const hit: CiResult = { state: cached.state, checkedAt: cached.checkedAt };
    if (cached.reason) hit.reason = cached.reason;
    if (cached.sha) hit.sha = cached.sha;
    if (cached.workflow) hit.workflow = cached.workflow;
    return hit;
  }

  const branch = (await git(repoPath, ['branch', '--show-current'])).trim();
  let result: CiResult;
  try {
    const exec = opts.exec ?? defaultExec;
    const out = exec(['run', 'list', '-R', slug, '--branch', branch, '--limit', '1', '--json', 'conclusion,status,headSha,workflowName']);
    const runs = JSON.parse(out) as Array<{ conclusion: string | null; status: string; headSha: string; workflowName: string }>;
    if (!runs.length) {
      result = { state: 'none', reason: 'no-runs', checkedAt: now };
    } else {
      const run = runs[0];
      if (run.status !== 'completed') {
        // in progress/queued: keep showing whatever we last knew, rather than flipping
        // to 'unknown' every time a new run kicks off.
        result = cached
          ? { state: cached.state, sha: run.headSha, workflow: run.workflowName, checkedAt: now }
          : { state: 'unknown', reason: 'in-progress', sha: run.headSha, workflow: run.workflowName, checkedAt: now };
      } else if (run.conclusion === 'success') {
        result = { state: 'pass', sha: run.headSha, workflow: run.workflowName, checkedAt: now };
      } else if (run.conclusion && FAIL_CONCLUSIONS.has(run.conclusion)) {
        result = { state: 'fail', sha: run.headSha, workflow: run.workflowName, checkedAt: now };
      } else {
        result = { state: 'unknown', reason: 'unrecognized', sha: run.headSha, workflow: run.workflowName, checkedAt: now };
      }
    }
  } catch {
    // gh missing / not authenticated / network error / bad JSON — never throw, never
    // print a per-repo error; render.ts surfaces one fleet-wide "gh unavailable" line.
    result = { state: 'unknown', reason: 'no-gh', checkedAt: now };
  }

  if (result.state !== 'unknown') {
    cache[repoPath] = { ...result, keySha, keyFrom };
    try {
      mkdirSync(home, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
    } catch {
      // best-effort cache
    }
  }
  return result;
}
