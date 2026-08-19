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

/** Worst severity among findings matching one service id. A trailing `*` (`worker-b/job-*`)
 *  matches by prefix (for repos that own a family of cron ids); otherwise a finding matches
 *  when its id is exactly `k8s:/cron:/site:<id>` or namespaced one level deeper (`<id>:pod1`). */
function runtimeForOne(id: string, findings: PulseFinding[]): 'ok' | 'warn' | 'crit' {
  const wildcard = id.endsWith('*');
  const base = wildcard ? id.slice(0, -1) : id;
  const prefixes = ['k8s:', 'cron:', 'site:'].map((p) => `${p}${base}`);
  let worst: 'ok' | 'warn' | 'crit' = 'ok';
  for (const f of findings) {
    const hit = wildcard ? prefixes.some((p) => f.id.startsWith(p)) : prefixes.some((p) => f.id === p || f.id.startsWith(`${p}:`));
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
