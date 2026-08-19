import type { Repo } from './types.js';

const DAY = 86_400_000;
const DORMANT_DAYS = 180;

/** Attention score: what needs a decision or a push, not raw activity.
 *  Tags are the explanation and render next to the number. */
export function score(r: Repo, now: number, staleDays = 7): { score: number; reasons: string[] } {
  let s = 0;
  const why: string[] = [];
  const g = r.git;
  // years-dormant, not "went cold recently": no commit AND no session in DORMANT_DAYS.
  // Dirty-file count alone would otherwise rank a years-abandoned repo alongside this
  // week's real work — cap its contribution and say so instead of piling on stale-dirty too.
  const dormant = !!(g && g.lastCommitTs && now - g.lastCommitTs > DORMANT_DAYS * DAY &&
    (!r.sessions.last || now - r.sessions.last > DORMANT_DAYS * DAY));
  if (g) {
    const changed = g.dirty + g.untracked;
    if (changed) {
      if (dormant) {
        s += 2;
        why.push(`${changed} dirty, dormant ${Math.round((now - g.lastCommitTs) / DAY / 30)}mo`);
      } else {
        s += Math.min(changed, 20);
        why.push(`${changed} dirty`);
      }
    }
    if (g.ahead) {
      s += 5 + Math.min(g.ahead, 10);
      why.push(`${g.ahead} unpushed`);
      if (g.unpushedSince && now - g.unpushedSince > 3 * DAY) {
        s += 1;
        why.push(`unpushed ${Math.round((now - g.unpushedSince) / DAY)}d`);
      }
    }
    if (g.behind) {
      s += 2;
      why.push(`${g.behind} behind`);
    }
    // dirty and nobody's touched it in a week: half-done work going cold.
    // Not for `dormant` — that's not "going cold", it's already been cold for months.
    if (!dormant && changed && r.sessions.last && now - r.sessions.last > staleDays * DAY) {
      s += 8;
      why.push(`stale-dirty ${Math.round((now - r.sessions.last) / DAY)}d`);
    }
  }
  const primary = r.docs[0];
  if (primary) {
    if (primary.commitsBehind >= 20) {
      s += 8;
      why.push(`${primary.file} ${primary.commitsBehind}c stale`);
    } else if (primary.commitsBehind >= 5) {
      s += 4;
      why.push(`${primary.file} ${primary.commitsBehind}c stale`);
    }
  }
  if (r.feedback?.untriaged.length) {
    const n = r.feedback.untriaged.length;
    s += Math.min(n * 3, 12);
    why.push(`${n} untriaged feedback`);
  }
  if (r.deadPaths.length) {
    s += Math.min(r.deadPaths.length, 5);
    why.push(`CLAUDE.md: ${r.deadPaths.length} dead paths`);
  }
  if (r.runtime === 'crit') {
    s += 6;
    why.push('runtime ✗');
  } else if (r.runtime === 'warn') {
    s += 2;
    why.push('runtime ⚠');
  }
  if (r.gates?.ts !== undefined) {
    const age = now - r.gates.ts;
    if (r.gates.red.length) {
      s += 4;
      const h = age / 3_600_000;
      why.push(`gates ✗ ${r.gates.red.join(', ')} (${h < 24 ? `${Math.round(h)}h` : `${Math.round(age / DAY)}d`})`);
    } else if (age > 3 * DAY) {
      s += 2;
      why.push(`gates stale ${Math.round(age / DAY)}d`);
    }
  }
  return { score: s, reasons: why };
}
