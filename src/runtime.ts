import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface PulseFinding {
  id: string;
  severity: 'ok' | 'warn' | 'crit' | string;
}

export interface PulseLast {
  ts: number;
  findings: PulseFinding[];
}

export function readPulseLast(home = process.env.BRIEF_PULSE_HOME ?? join(homedir(), '.pulse')): PulseLast | null {
  const file = join(home, 'snaps', 'last.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const RANK: Record<string, number> = { ok: 0, warn: 1, crit: 2 };

/** Worst severity among findings matching one service id. Bare ids (`app/svc-a`) match a
 *  finding of any kind (`k8s:`, `cron:`, `site:`, `pvc:`, `node:`, `disk:`, `host:`); ids
 *  written with a kind prefix (`node:*`) match that kind only. A trailing `*` matches by
 *  prefix (for repos that own a family of cron ids). */
function runtimeForOne(id: string, findings: PulseFinding[]): 'ok' | 'warn' | 'crit' {
  const wildcard = id.endsWith('*');
  const base = wildcard ? id.slice(0, -1) : id;
  const kinded = /^[a-z0-9]+:/i.test(base);
  let worst: 'ok' | 'warn' | 'crit' = 'ok';
  for (const f of findings) {
    const target = kinded ? f.id : f.id.replace(/^[a-z0-9]+:/i, '');
    const hit = wildcard ? target.startsWith(base) : target === base || target.startsWith(`${base}:`);
    if (!hit) continue;
    if ((RANK[f.severity] ?? 0) > RANK[worst]) worst = f.severity as 'ok' | 'warn' | 'crit';
  }
  return worst;
}

/** Worst severity across a comma-separated list of service ids (`.brief.yaml` `service:`
 *  accepts `a/b, a/c-*` for repos that own more than one pulse id). */
export function runtimeFor(service: string, findings: PulseFinding[]): 'ok' | 'warn' | 'crit' {
  let worst: 'ok' | 'warn' | 'crit' = 'ok';
  for (const id of service.split(',').map((s) => s.trim()).filter(Boolean)) {
    const w = runtimeForOne(id, findings);
    if (RANK[w] > RANK[worst]) worst = w;
  }
  return worst;
}
