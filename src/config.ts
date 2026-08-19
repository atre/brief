import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Per-repo overrides in `.brief.yaml` (flat, tiny subset of YAML — no deps):
 *    stateDoc: docs/actions-dev.md     # primary state doc (path relative to repo)
 *    nextHeading: Open items           # heading cue for "next" (substring, case-insensitive)
 *    description: one line             # override the README/CLAUDE.md pick
 *    ignore: true                      # drop the repo from the radar entirely
 *    service: app/svc-a                # pulse finding id suffix this repo owns (k8s:/cron:/site:)
 *                                       # comma-separated for multiple ids; trailing `*` = prefix match
 *                                       # (e.g. `worker-b/svc-1, worker-b/job-*`)
 *    agentRunnable: true               # force `brief queue` to list this repo (else: state doc has the marker)
 */
export interface RepoConfig {
  stateDoc?: string;
  nextHeading?: string;
  description?: string;
  ignore?: boolean;
  service?: string;
  agentRunnable?: boolean;
}

export function readConfig(dir: string): RepoConfig {
  const p = join(dir, '.brief.yaml');
  if (!existsSync(p)) return {};
  const cfg: RepoConfig = {};
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, k, v0] = m;
    const v = v0.replace(/^["']|["']$/g, '');
    if (k === 'stateDoc') cfg.stateDoc = v;
    else if (k === 'nextHeading') cfg.nextHeading = v;
    else if (k === 'description') cfg.description = v;
    else if (k === 'ignore') cfg.ignore = v === 'true' || v === 'yes' || v === '1';
    else if (k === 'service') cfg.service = v;
    else if (k === 'agentRunnable') cfg.agentRunnable = v === 'true' || v === 'yes' || v === '1';
  }
  return cfg;
}
