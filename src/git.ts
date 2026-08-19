import { execFile } from 'node:child_process';
import type { GitInfo } from './types.js';

export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout) => resolve(err ? '' : stdout),
    );
  });
}

export async function gitInfo(cwd: string, maxFiles = 200): Promise<GitInfo | null> {
  const status = await git(cwd, ['status', '--porcelain=v2', '--branch', '-unormal', '--no-renames']);
  if (!status && !(await git(cwd, ['rev-parse', '--is-inside-work-tree']))) return null;
  const info: GitInfo = {
    branch: '',
    dirty: 0,
    untracked: 0,
    ahead: 0,
    unpushedSince: 0,
    behind: 0,
    noUpstream: true,
    lastCommitTs: 0,
    lastCommitMsg: '',
    dirtyFiles: [],
    recent: [],
  };
  for (const line of status.split('\n')) {
    if (!line) continue;
    if (line.startsWith('# branch.head ')) info.branch = line.slice(14).trim();
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        info.ahead = Number(m[1]);
        info.behind = Number(m[2]);
        info.noUpstream = false;
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      info.dirty++;
      const parts = line.split(' ');
      if (info.dirtyFiles.length < maxFiles) info.dirtyFiles.push(parts[parts.length - 1]);
    } else if (line.startsWith('? ')) {
      info.untracked++;
      if (info.dirtyFiles.length < maxFiles) info.dirtyFiles.push(line.slice(2));
    }
  }
  if (info.ahead > 0) {
    const unpushed = (await git(cwd, ['log', '@{u}..HEAD', '--format=%at'])).trim().split('\n').filter(Boolean);
    if (unpushed.length) info.unpushedSince = Number(unpushed[unpushed.length - 1]) * 1000;
  }
  const log = await git(cwd, ['log', '-6', '--format=%ct%x09%h%x09%s']);
  const lines = log.split('\n').filter(Boolean);
  if (lines[0]) {
    const [ts, , ...rest] = lines[0].split('\t');
    info.lastCommitTs = Number(ts) * 1000;
    info.lastCommitMsg = rest.join('\t');
  }
  info.recent = lines.slice(0, 5).map((l) => {
    const [, h, ...rest] = l.split('\t');
    return `${h} ${rest.join('\t')}`;
  });
  return info;
}

/** Last commit touching `file`: {ts (ms), hash}; ts 0 if never committed. */
export async function lastTouched(cwd: string, file: string): Promise<{ ts: number; hash: string }> {
  const out = (await git(cwd, ['log', '-1', '--format=%ct %H', '--', file])).trim();
  if (!out) return { ts: 0, hash: '' };
  const [ts, hash] = out.split(' ');
  return { ts: Number(ts) * 1000, hash };
}

/** Commits on HEAD after `hash` (topology, not timestamps — same-second commits count). */
export async function commitsSince(cwd: string, hash: string): Promise<number> {
  if (!hash) return 0;
  const out = await git(cwd, ['rev-list', '--count', `${hash}..HEAD`]);
  return Number(out.trim() || 0);
}
