import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { git } from './git.js';
import type { Repo } from './types.js';

export type Visibility = 'public' | 'private' | 'local' | 'unknown';

export const VISIBILITY_TTL_MS = 7 * 86_400_000;

export const briefHome = () => process.env.BRIEF_HOME ?? join(homedir(), '.brief');

export function githubSlug(remote: string): string | null {
  const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? m[1] : null;
}

function ghVisibility(slug: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      ['repo', 'view', slug, '--json', 'visibility', '-q', '.visibility'],
      { encoding: 'utf8', timeout: 10_000 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

export async function attachVisibility(
  repos: Repo[],
  opts: { home: string; now: number; refresh?: boolean; probe?: (slug: string) => Promise<string>; remote?: (path: string) => Promise<string> },
): Promise<void> {
  const probe = opts.probe ?? ghVisibility;
  const remote = opts.remote ?? ((p: string) => git(p, ['remote', 'get-url', 'origin']));
  const cacheFile = join(opts.home, 'visibility.json');
  let cache: Record<string, { visibility: Visibility; checkedAt: number }> = {};
  try {
    cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {
    cache = {};
  }
  let wrote = false;
  for (const r of repos) {
    const cached = cache[r.path];
    if (cached && !opts.refresh && opts.now - cached.checkedAt < VISIBILITY_TTL_MS) {
      r.visibility = cached.visibility;
      continue;
    }
    const remoteUrl = await remote(r.path);
    const slug = githubSlug(remoteUrl);
    let v: Visibility;
    if (!slug) {
      v = 'local';
    } else {
      try {
        const s = (await probe(slug)).trim().toLowerCase();
        v = s === 'public' || s === 'private' ? s : 'unknown';
      } catch {
        v = 'unknown';
      }
    }
    r.visibility = v;
    if (v !== 'unknown') {
      cache[r.path] = { visibility: v, checkedAt: opts.now };
      wrote = true;
    }
  }
  if (wrote) {
    try {
      mkdirSync(opts.home, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
    } catch {
      // best-effort cache
    }
  }
}
