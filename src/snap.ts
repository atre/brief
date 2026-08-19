import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Report } from './types.js';

export interface SnapRepo {
  name: string;
  score: number;
  reasons: string[];
  dirty: number;
  ahead: number;
  lastCommitTs: number;
  next: string;
}

export interface Snap {
  ts: number;
  repos: SnapRepo[];
}

export function toSnap(rep: Report): Snap {
  return {
    ts: rep.now,
    repos: rep.repos.map((r) => ({
      name: r.name,
      score: r.score,
      reasons: r.reasons,
      dirty: (r.git?.dirty ?? 0) + (r.git?.untracked ?? 0),
      ahead: r.git?.ahead ?? 0,
      lastCommitTs: r.git?.lastCommitTs ?? 0,
      next: r.docs[0]?.next[0] ?? '',
    })),
  };
}

const snapHome = () => process.env.BRIEF_HOME ?? join(homedir(), '.brief');

export function writeSnap(rep: Report, name: string, home = snapHome()): string {
  const dir = join(home, 'snaps');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(toSnap(rep), null, 2));
  return file;
}

export function readSnap(name: string, home = snapHome()): Snap | null {
  const file = join(home, 'snaps', `${name}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export interface SnapDiff {
  new: string[];
  gone: string[];
  changed: { name: string; from: number; to: number; reasons: string[] }[];
  unchanged: number;
}

/** What changed between two snapshots, keyed by repo name. */
export function diffSnaps(prev: Snap, cur: Snap): SnapDiff {
  const prevMap = new Map(prev.repos.map((r) => [r.name, r]));
  const curMap = new Map(cur.repos.map((r) => [r.name, r]));
  const out: SnapDiff = { new: [], gone: [], changed: [], unchanged: 0 };
  for (const name of curMap.keys()) if (!prevMap.has(name)) out.new.push(name);
  for (const name of prevMap.keys()) if (!curMap.has(name)) out.gone.push(name);
  for (const [name, c] of curMap) {
    const p = prevMap.get(name);
    if (!p) continue;
    if (p.score !== c.score) out.changed.push({ name, from: p.score, to: c.score, reasons: c.reasons });
    else out.unchanged++;
  }
  return out;
}
