import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { slugFor } from './sessions.js';

export interface SnuffLast {
  ts: number;
  ok: boolean;
  gates: { name: string; ok: boolean; skipped: string | null }[];
}

type RawGate = { name?: string; gate?: { name?: string }; ok?: boolean; skipped?: string | null };
type RawLast = { ts?: number | string; ok?: boolean; gates?: RawGate[] };

/** Accept both writer shapes: `{ts:number, gates:[{name}]}` (~/.snuff/<slug>.json) and
 *  snuff's in-repo `.snuff/last.json` (`ts` ISO string, `gates[].gate.name`). Bad shape → null. */
export function normaliseSnuffLast(raw: unknown): SnuffLast | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as RawLast;
  const ts = typeof r.ts === 'number' ? r.ts : typeof r.ts === 'string' ? Date.parse(r.ts) : NaN;
  if (!Number.isFinite(ts) || !Array.isArray(r.gates)) return null;
  const gates: SnuffLast['gates'] = [];
  for (const g of r.gates) {
    const name = g?.name ?? g?.gate?.name;
    if (typeof name !== 'string') continue;
    gates.push({ name, ok: g.ok === true, skipped: g.skipped ?? null });
  }
  const ok = typeof r.ok === 'boolean' ? r.ok : gates.every((g) => g.ok || g.skipped);
  return { ts, ok, gates };
}

function readJson(file: string): unknown {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** snuff's last result: `~/.snuff/<slug>.json` first (same slug scheme as Claude Code session dirs),
 *  else the in-repo `<repo>/.snuff/last.json` snuff writes today. Missing/unparseable → null. */
export function readSnuffLast(repoPath: string, home = process.env.BRIEF_SNUFF_HOME ?? join(homedir(), '.snuff')): SnuffLast | null {
  const global = normaliseSnuffLast(readJson(join(home, `${slugFor(repoPath)}.json`)));
  if (global) return global;
  return normaliseSnuffLast(readJson(join(repoPath, '.snuff', 'last.json')));
}
