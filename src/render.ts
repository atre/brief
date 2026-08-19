import type { Repo, Report } from './types.js';
import type { HubDiff } from './hub.js';
import type { QueueRow } from './queue.js';
import type { SnapDiff } from './snap.js';
import { fmtTokens } from './tokens.js';

const DAY = 86_400_000;

export function ago(ts: number, now: number): string {
  if (!ts) return '—';
  const d = (now - ts) / DAY;
  if (d < 1 / 24) return `${Math.max(1, Math.round(d * 24 * 60))}min`;
  if (d < 1) return `${Math.round(d * 24)}h`;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}

function isQuiet(r: Repo): boolean {
  return r.score === 0;
}

export function renderText(rep: Report, opts: { top: number; all: boolean; brief?: boolean }): string {
  const { now } = rep;
  const repos = [...rep.repos].sort((a, b) => b.score - a.score || b.sessions.last - a.sessions.last);
  const dirty = repos.filter((r) => r.git && r.git.dirty + r.git.untracked > 0).length;
  const unpushed = repos.filter((r) => r.git?.ahead).length;
  const untriaged = repos.filter((r) => r.feedback?.untriaged.length).length;
  const active = repos.filter((r) => r.sessions.count7d > 0).length;
  const out: string[] = [];
  out.push(
    `brief — ${repos.length} repos · ${dirty} dirty · ${unpushed} unpushed · ${untriaged} with untriaged FEEDBACK · ${active} active (7d)`,
  );
  const shown = opts.all ? repos : repos.filter((r) => !isQuiet(r)).slice(0, opts.top);
  const w = Math.min(22, Math.max(6, ...shown.map((r) => r.name.length)));
  for (const r of shown) {
    const g = r.git;
    const bits: string[] = [];
    bits.push(r.sessions.last ? `${r.sessions.count7d} sess/7d · last ${ago(r.sessions.last, now)}` : 'no sessions');
    if (g) bits.push(`commit ${ago(g.lastCommitTs, now)}${g.branch && g.branch !== 'main' && g.branch !== 'master' ? ` ${g.branch}` : ''}`);
    else bits.push('docs only');
    if (g?.ahead) bits.push(`${g.ahead} unpushed${g.unpushedSince ? ` (${ago(g.unpushedSince, now)})` : ''}`);
    const primary = r.docs[0];
    if (primary) bits.push(`${primary.file} ${ago(primary.mtime, now)}${primary.open ? ` ${primary.open} open` : ''}`);
    if (!r.snuff) bits.push('no snuff');
    if (r.tokens7d !== undefined) bits.push(`${fmtTokens(r.tokens7d)} tok/7d`);
    const plan = r.docs.find((d) => d.file.toLowerCase() === 'plan.md');
    if (plan && plan.open + plan.done > 0) bits.push(`PLAN ${plan.done}/${plan.open + plan.done}`);
    out.push(`${r.name.padEnd(w)} ${String(r.score).padStart(3)}  ${r.reasons.join(' · ') || 'quiet'}`);
    out.push(`${''.padEnd(w)}      ${bits.join(' · ')}`);
    const next = primary?.next[0];
    if (next && !opts.brief) out.push(`${''.padEnd(w)}      ↳ ${next}`);
  }
  if (opts.brief) {
    const rest = repos.filter((r) => !shown.includes(r) && !isQuiet(r));
    const more = rest.length ? `… +${rest.length} more, run brief` : null;
    const cap = more ? 14 : 15;
    const kept = out.length > cap ? out.slice(0, cap) : out;
    return [...kept, ...(more ? [more] : [])].join('\n');
  }
  if (!opts.all) {
    const rest = repos.filter((r) => !shown.includes(r));
    const fold = rest.filter((r) => !isQuiet(r));
    const quiet = rest.filter(isQuiet);
    if (fold.length) {
      const shownFold = fold.slice(0, 12).map((r) => `${r.name} ${r.score}`);
      out.push(`below the fold: ${shownFold.join(', ')}${fold.length > 12 ? ` … +${fold.length - 12}` : ''}`);
    }
    if (quiet.length) out.push(`quiet: ${quiet.length}${quiet.length <= 12 ? ` — ${quiet.map((r) => r.name).join(', ')}` : ' (--all to list)'}`);
  }
  return out.join('\n');
}

export function renderRepo(r: Repo, now: number, budget: { files: number; commits: number; next: number; lastSaid?: 'full' | 'trim' | 'drop' }): string {
  const out: string[] = [];
  out.push(`# ${r.name}${r.description ? ` — ${r.description}` : ''}`);
  const g = r.git;
  if (g) {
    const up = g.noUpstream ? 'no upstream' : `${g.ahead} unpushed${g.behind ? `, ${g.behind} behind` : ''}`;
    out.push(`git: ${g.branch || '?'} · ${g.dirty} modified + ${g.untracked} untracked · ${up} · last commit ${ago(g.lastCommitTs, now)} "${g.lastCommitMsg}"`);
  } else out.push('git: not a repo');
  out.push(`sessions: ${r.sessions.count7d} in 7d · last ${ago(r.sessions.last, now)}${r.snuff ? ' · snuff: yes' : ' · snuff: no'}`);
  if (r.lastSaid && budget.lastSaid !== 'drop') {
    const text = budget.lastSaid === 'trim' ? r.lastSaid.text.slice(0, 120) : r.lastSaid.text;
    out.push(`last session said: ${text} (${ago(r.lastSaid.ts, now)}${r.lastSaid.turns !== undefined ? `, ${r.lastSaid.turns} turns` : ''})`);
  }
  if (r.gates !== undefined) {
    const g = r.gates;
    if (g === null) out.push('gates: unavailable');
    else if (g.red.length) out.push(`gates: ✗ ${g.passed}/${g.total} — ${g.red.join(', ')}`);
    else out.push(`gates: ✓ ${g.passed}/${g.total}`);
  }
  if (r.runtime !== undefined) out.push(`runtime: ${r.runtime === 'ok' ? '✓' : r.runtime === 'warn' ? '⚠' : '✗'}`);
  if (r.docs.length) {
    out.push(
      `docs: ${r.docs
        .map((d) => `${d.file} ${ago(d.mtime, now)}${d.commitsBehind ? ` (${d.commitsBehind}c behind)` : ''}${d.open ? ` ${d.open} open` : ''}`)
        .join(' · ')}`,
    );
  } else out.push('docs: none of STATE/STATUS/TODO/PLAN.md');
  if (r.deadPaths.length) out.push(`dead paths: ${r.deadPaths.join(', ')}`);
  const primary = r.docs[0];
  if (primary?.next.length) {
    out.push(`next (${primary.nextSource ?? primary.file}):`);
    for (const n of primary.next.slice(0, budget.next)) out.push(`  - ${n}`);
  }
  if (r.feedback) {
    const u = r.feedback.untriaged;
    out.push(`feedback: ${r.feedback.sections} sections · ${u.length} untriaged${u.length ? ':' : ''}`);
    for (const h of u.slice(0, budget.next)) out.push(`  - ${h}`);
  }
  if (g && g.dirtyFiles.length) {
    out.push(`dirty (${g.dirtyFiles.length}${g.dirty + g.untracked > g.dirtyFiles.length ? '+' : ''}):`);
    for (const f of groupFiles(g.dirtyFiles, budget.files)) out.push(`  ${f}`);
  }
  if (g && g.recent.length) {
    out.push('recent commits:');
    for (const c of g.recent.slice(0, budget.commits)) out.push(`  ${c}`);
  }
  return out.join('\n');
}

/** Fold dirty paths by top-level dir when there are many. */
export function groupFiles(files: string[], max: number): string[] {
  if (files.length <= max) return files;
  const byDir = new Map<string, number>();
  for (const f of files) {
    const dir = f.includes('/') ? `${f.split('/')[0]}/` : f;
    byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
  }
  return [...byDir.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([d, n]) => (n > 1 ? `${d} ×${n}` : d));
}

export function renderDiff(d: SnapDiff, prevTs: number, now: number): string {
  const out = [`brief diff — since ${ago(prevTs, now)}: ${d.new.length} new · ${d.gone.length} gone · ${d.changed.length} changed · ${d.unchanged} unchanged`];
  for (const c of d.changed) {
    const delta = c.to - c.from;
    out.push(`${c.name}   ${c.from} → ${c.to}  ${delta >= 0 ? '+' : ''}${delta}  ${c.reasons[0] ?? ''}`);
  }
  if (d.new.length) out.push(`new: ${d.new.join(', ')}`);
  if (d.gone.length) out.push(`gone: ${d.gone.join(', ')}`);
  return out.join('\n');
}

export function renderQueue(rows: QueueRow[]): string {
  if (!rows.length) return 'queue: empty — no repo has "How to run this plan (agent)" (or .brief.yaml agentRunnable: true)';
  return rows
    .map((r) => `${r.repo}  PLAN ${r.done}/${r.done + r.open}  ↳ ${r.next.length > 80 ? `${r.next.slice(0, 79)}…` : r.next || '—'}`)
    .join('\n');
}

export function renderHub(diff: HubDiff): string {
  const out = [
    `hub table: ${diff.listed} listed · ${diff.missing.length} missing · ${diff.gone.length} gone · ${diff.notRepo.length} not a git repo`,
  ];
  if (diff.missing.length) {
    out.push('missing from hub CLAUDE.md (candidate rows):');
    for (const r of diff.missing) out.push(`| \`${r.name}\` | ${r.description || '—'} |`);
  }
  if (diff.gone.length) out.push(`listed but dir is gone: ${diff.gone.join(', ')}`);
  if (diff.notRepo.length) out.push(`listed, dir exists, not a git repo (or excluded): ${diff.notRepo.join(', ')}`);
  return out.join('\n');
}

export function renderMd(rep: Report, top: number): string {
  const repos = [...rep.repos].sort((a, b) => b.score - a.score).slice(0, top);
  const out = ['# brief', '', '| repo | score | why | sessions 7d | tok 7d | last commit | unpushed since | next |', '|---|---|---|---|---|---|---|---|'];
  for (const r of repos) {
    out.push(
      `| ${r.name} | ${r.score} | ${r.reasons.join(', ')} | ${r.sessions.count7d} | ${r.tokens7d !== undefined ? fmtTokens(r.tokens7d) : '—'} | ${ago(r.git?.lastCommitTs ?? 0, rep.now)} | ${r.git?.unpushedSince ? ago(r.git.unpushedSince, rep.now) : '—'} | ${(r.docs[0]?.next[0] ?? '').replace(/\|/g, '\\|')} |`,
    );
  }
  return out.join('\n');
}

function dateStr(ts: number): string {
  return ts ? new Date(ts).toISOString().slice(0, 10) : '—';
}

export function renderLessons(rep: Report): string {
  const rows = rep.repos.flatMap((r) => r.feedback?.lessons.map((l) => ({ repo: r.name, ...l })) ?? []);
  if (!rows.length) return 'no "- lesson:" bullets found';
  return [`lessons — ${rows.length} across ${new Set(rows.map((r) => r.repo)).size} repos`, ...rows.map((r) => `${r.repo} (${dateStr(r.ts)}) — ${r.text}`)].join('\n');
}

export function renderLessonsMd(rep: Report): string {
  const rows = rep.repos.flatMap((r) => r.feedback?.lessons.map((l) => ({ repo: r.name, ...l })) ?? []);
  const out = ['| repo | date | lesson |', '|---|---|---|'];
  for (const r of rows) out.push(`| ${r.repo} | ${dateStr(r.ts)} | ${r.text.replace(/\|/g, '\\|')} |`);
  return out.join('\n');
}

export function renderFeedback(rep: Report): string {
  const withFb = rep.repos.filter((r) => r.feedback?.items.length).sort((a, b) => b.feedback!.items.length - a.feedback!.items.length);
  const total = withFb.reduce((n, r) => n + r.feedback!.items.length, 0);
  const out = [`feedback — ${total} untriaged sections in ${withFb.length} repos (newer than each repo's PLAN.md)`];
  for (const r of withFb) {
    out.push(`${r.name} (${r.feedback!.items.length}) — ${r.path}/FEEDBACK.md`);
    for (const it of r.feedback!.items) out.push(`  · ${it.header}${it.preview ? `\n      ${it.preview}` : ''}`);
  }
  if (!withFb.length) out.push('nothing untriaged — every dated section predates its PLAN.md');
  return out.join('\n');
}
