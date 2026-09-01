import type { Finding, Repo } from './types.js';

/** A repo whose attention score is 0 has nothing to say — the text renderer already
 *  treats that as "quiet" and hides it. Same rule here: one `ok` finding per quiet repo
 *  would put ~30 rows that never need an action into every fleet-wide join. */
const QUIET = 0;

/** Reason tags that mean *a downstream tool already reported red* — snuff said the gate
 *  failed, pulse said the runtime is crit, GitHub said the run failed. Those are broken,
 *  not merely unattended, and that distinction is borrowed rather than invented: brief
 *  is relaying a verdict another tool made, not scoring one of its own. */
function isBroken(r: Repo): boolean {
  return (r.gates?.red.length ?? 0) > 0 || r.ci?.state === 'fail' || r.runtime === 'crit';
}

/** `repos[]` → the fleet finding schema (hub TOOLS.md § Finding schema; pulse
 *  `src/types.ts` is the reference). Derived from the existing `score`/`reasons`, never
 *  re-scored: a consumer reading `findings[]` and a human reading the text table must
 *  rank the fleet the same way. */
export function toFindings(repos: Repo[]): Finding[] {
  return [...repos]
    .filter((r) => r.score > QUIET)
    .sort((a, b) => b.score - a.score || b.sessions.last - a.sessions.last)
    .map((r) => ({
      id: `repo:${r.name}`,
      scope: 'repo' as const,
      severity: isBroken(r) ? ('crit' as const) : ('warn' as const),
      title: `${r.name} — ${r.reasons.join(' · ')}`,
      detail: `attention score ${r.score}`,
      // the per-repo view: what the reader opens next to act on any of these reasons
      hint: `brief ${r.name}`,
    }));
}
