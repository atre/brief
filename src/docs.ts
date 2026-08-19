import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { lastTouched, commitsSince } from './git.js';
import type { DocInfo, FeedbackInfo, FeedbackSection } from './types.js';

/** State docs in priority order — the first one present drives "next". */
export const STATE_DOCS = ['STATE.md', 'STATUS.md', 'TODO.md', 'PLAN.md', 'plan.md'];
// heading must *start* with the cue ("## Next", "## What's next", "# STATE — resume here" also
// matches via "resume"); "Next.js" is not a cue.
const NEXT_HEADING =
  /^#{1,4}\s+(?:[^\w\n]*)(?:what'?s\s+)?(next(?!\.js)|resume|now|where (?:we|i) (?:are|am)|todo|open items|in progress|current(?: work| state)?)\b|^#{1,4}\s+.*\b(?:resume here)\b/i;
const DESC_MAX = 110;

export function readIf(p: string): string | null {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  } catch {
    return null;
  }
}

const DEAD_PATH_TOKEN = /^[\w./~-]+$/;
const DEAD_PATH_EXT = /\.(md|txt|ts|tsx|js|mjs|cjs|json|yaml|yml|py|toml|sh|go|rs|css|html|sql|env)$/i;
// bare filenames (no `/`) only count with a source-ish extension — `state.json`, `hosts.json` are usually runtime/generated
const DEAD_BARE_EXT = /\.(md|txt|ts|tsx|js|mjs|cjs|py|sh|go|rs|css|html|sql)$/i;
const DEAD_WALK_SKIP = new Set(['node_modules', '.git', 'dist', 'test-dist', 'build', '.next', 'coverage', 'vendor', '__pycache__']);

/** All directories under `dir` up to `depth` (skipping build/vendor dirs), root first. */
function walkDirs(dir: string, depth = 4, out: string[] = []): string[] {
  out.push(dir);
  if (depth === 0) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.isSymbolicLink() || DEAD_WALK_SKIP.has(e.name)) continue;
    walkDirs(join(dir, e.name), depth - 1, out);
  }
  return out;
}

/** Is this backticked token plausibly a repo path (not a CIDR, flag, regex, URL path, product name…)? */
export function isPathCandidate(raw: string): boolean {
  if (!DEAD_PATH_TOKEN.test(raw)) return false;
  if (raw.startsWith('--') || raw.includes('/--')) return false; // flag pairs: `--level/--grep`
  if (/^[\d.]+(\/\d+)?$/.test(raw)) return false; // IPs / CIDRs
  if (/^[A-Z][a-z]+\.[a-z]+$/.test(raw)) return false; // `Next.js`, `Vue.js` product names
  const hasSlash = raw.includes('/');
  if (!hasSlash) return DEAD_BARE_EXT.test(raw);
  if (raw.startsWith('/')) {
    // absolute: only user/home roots are checkable; `/admin`, `/DDP/i`, `/tmp/x` are URL paths, regexes, transient
    return raw.startsWith('/Users/') || raw.startsWith('/home/');
  }
  if (raw.startsWith('~/')) return true;
  if (raw.startsWith('./')) return true;
  return /^[a-z._]/.test(raw); // relative, lowercase-led (`Word/x` reads as prose)
}

/** Backticked paths in CLAUDE.md that no longer resolve on disk, capped at 5.
 *  Relative paths resolve against the repo root, else against any subdir (depth ≤ 4: `lib/db/x.ts`
 *  under `src/`, `__tests__/` colocated); bare filenames the same way; `~/` and `/Users/` paths
 *  are dead only when they truly don't exist. Ext-less two-segment tokens (`chore/description`,
 *  `next/image`) count only when their first segment is a directory somewhere in the repo. */
export function deadPaths(dir: string, text: string, home = homedir()): string[] {
  const seen = new Set<string>();
  const dead: string[] = [];
  let dirs: string[] | null = null; // lazy: only walk when a root lookup fails
  const anywhere = (rel: string) => (dirs ??= walkDirs(dir)).some((d) => existsSync(join(d, rel)));
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    const raw = m[1].trim();
    if (seen.has(raw) || !isPathCandidate(raw)) continue;
    seen.add(raw);
    let alive: boolean;
    if (raw.startsWith('~/')) alive = existsSync(join(home, raw.slice(2)));
    else if (raw.startsWith('/')) alive = existsSync(raw);
    else {
      const rel = raw.replace(/^\.\//, '');
      alive = existsSync(join(dir, rel)) || anywhere(rel);
      if (!alive && rel.includes('/') && !rel.endsWith('/') && !DEAD_PATH_EXT.test(rel)) {
        // no ext, no trailing slash: package specifier / branch pattern unless its first segment is a real dir
        const first = rel.split('/')[0];
        if (existsSync(join(dir, 'node_modules', first)) || !anywhere(first)) continue;
      }
    }
    if (!alive) dead.push(raw);
    if (dead.length >= 5) break;
  }
  return dead;
}

/** Marks a PLAN/state doc as safe for an unattended agent to run top-down. */
export function isAgentRunnable(text: string): boolean {
  return /How to run this plan/i.test(text);
}

/** First open PLAN item (1-indexed line), skipping a bare "- [ ] done" placeholder;
 *  continuation lines indented ≥ 2 spaces are folded into `text`. */
export function nextItem(text: string): { line: number; text: string } | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*[-*]\s+\[ \]\s+\S/.test(lines[i])) continue;
    if (/^- \[ \] done$/i.test(lines[i].trim())) continue;
    let out = lines[i];
    let j = i + 1;
    while (j < lines.length && /^ {2,}\S/.test(lines[j])) out += `\n${lines[j++]}`;
    return { line: i + 1, text: out };
  }
  return null;
}

/** One-line description: first prose paragraph of CLAUDE.md, else README.md, else ''. */
export function describe(dir: string): string {
  for (const f of ['README.md', 'CLAUDE.md']) {
    const text = readIf(join(dir, f));
    if (!text) continue;
    const d = firstParagraph(text);
    if (d) return d;
  }
  return '';
}

const BOILERPLATE = /^(this file provides guidance|read [`A-Z]|see [`A-Z]|always |never |before (touching|starting)|run |use |do(n't| not) |when |if )/i;

export function firstParagraph(text: string): string {
  let inFence = false;
  const paras: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) paras.push(cur.join(' '));
    cur = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      flush();
      continue;
    }
    if (inFence) continue;
    if (!line) {
      flush();
      continue;
    }
    // headings, tables, html, badges, bullets, quotes end/skip a paragraph
    if (/^(#|\||<|\[!\[|[-*] |>|\d+\. )/.test(line)) {
      flush();
      continue;
    }
    cur.push(line);
  }
  flush();
  for (const p of paras) {
    const clean = p.replace(/\*\*/g, '').replace(/`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
    if (!clean || BOILERPLATE.test(clean)) continue; // instructions to the agent, not what the repo is
    // first sentence is usually the pitch
    const sentence = /^(.+?[.!?])(\s|$)/.exec(clean)?.[1] ?? clean;
    const pick = sentence.length >= 25 ? sentence : clean;
    return pick.length > DESC_MAX ? `${pick.slice(0, DESC_MAX - 1).trimEnd()}…` : pick;
  }
  return '';
}

/** Best-effort "what's next": bullets under a next-ish heading, else open checkboxes. */
export function headingCue(cue?: string): RegExp {
  if (!cue) return NEXT_HEADING;
  const esc = cue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^#{1,6}\\s+.*${esc}`, 'i');
}

export function extractNext(text: string, max = 5, headings: boolean | RegExp = true): { open: number; done: number; next: string[] } {
  const cue = headings instanceof RegExp ? headings : NEXT_HEADING;
  const lines = text.split('\n');
  let open = 0;
  let done = 0;
  for (const l of lines) {
    if (/^\s*[-*]\s+\[ \]/.test(l)) open++;
    else if (/^\s*[-*]\s+\[[xX]\]/.test(l)) done++;
  }
  const next: string[] = [];
  const push = (l: string) => {
    const t = l
      .replace(/^\s*[-*]\s+(\[[ xX]\]\s*)?/, '')
      .replace(/\*\*/g, '')
      .trim();
    if (/^(✅|✔|☑|~~|DONE\b|\[done\])/i.test(t)) return; // done markers outside checkbox syntax
    if (t && !next.includes(t) && next.length < max) next.push(t.length > 140 ? `${t.slice(0, 139)}…` : t);
  };
  // 1) bullets (or checkboxes) under the first next-ish heading
  for (let i = 0; headings && i < lines.length && next.length < max; i++) {
    if (!cue.test(lines[i])) continue;
    let prose = '';
    for (let j = i + 1; j < lines.length && next.length < max; j++) {
      const l = lines[j];
      if (/^#{1,6}\s/.test(l)) break;
      if (/^\s*[-*]\s+\[[xX]\]/.test(l)) continue;
      if (/^\s*[-*]\s+\S/.test(l)) push(l);
      else if (!prose && /^\s*\S/.test(l) && !l.trim().startsWith('```')) prose = l.trim();
    }
    // heading found but no bullets under it: the first prose line is the best we have
    if (!next.length && prose) push(`- ${prose}`);
    break;
  }
  // 2) open checkboxes anywhere
  if (next.length < max) for (const l of lines) if (/^\s*[-*]\s+\[ \]/.test(l)) push(l);
  return { open, done, next };
}

export async function docInfos(dir: string, isGit: boolean, cfg: { stateDoc?: string; nextHeading?: string } = {}): Promise<DocInfo[]> {
  const out: DocInfo[] = [];
  const seen = new Set<string>(); // case-insensitive FS: PLAN.md and plan.md are one file
  const files = cfg.stateDoc ? [cfg.stateDoc, ...STATE_DOCS] : STATE_DOCS;
  const cue = headingCue(cfg.nextHeading);
  for (const file of files) {
    if (seen.has(file.toLowerCase())) continue;
    const p = join(dir, file);
    const text = readIf(p);
    if (text === null) continue;
    seen.add(file.toLowerCase());
    const fsm = statSync(p).mtimeMs;
    const touched = isGit ? await lastTouched(dir, file) : { ts: 0, hash: '' };
    // if the doc has uncommitted edits, the fs mtime is the truth
    const mtime = fsm > touched.ts ? fsm : touched.ts;
    const { open, done, next } = extractNext(text, 5, cue);
    const commitsBehind = isGit ? await commitsSince(dir, touched.hash) : 0;
    out.push({ file, mtime, open, done, next, commitsBehind });
  }
  return out;
}

const DATE_RE = /(\d{4}-\d{2}-\d{2})/;

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Split FEEDBACK.md into `## ` sections with a one-line preview each. */
export function feedbackSections(text: string): FeedbackSection[] {
  const out: FeedbackSection[] = [];
  let cur: FeedbackSection | null = null;
  for (const raw of text.split('\n')) {
    if (/^##\s+/.test(raw)) {
      const header = raw.replace(/^##\s+/, '').trim();
      const m = DATE_RE.exec(header);
      cur = { header, ts: m ? Date.parse(m[1]) : 0, preview: '' };
      out.push(cur);
      continue;
    }
    if (cur && !cur.preview) {
      const t = raw.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim();
      if (t) cur.preview = t.length > 160 ? `${t.slice(0, 159)}…` : t;
    }
  }
  return out;
}

/** `- lesson: …` bullets anywhere in FEEDBACK.md, any section, triaged or not; ts = enclosing section's date. */
export function extractLessons(text: string): { ts: number; text: string }[] {
  const out: { ts: number; text: string }[] = [];
  let ts = 0;
  for (const raw of text.split('\n')) {
    if (/^##\s+/.test(raw)) {
      const m = DATE_RE.exec(raw);
      ts = m ? Date.parse(m[1]) : 0;
      continue;
    }
    const m = /^\s*[-*]\s+lesson:\s*(.+)$/i.exec(raw);
    if (m) out.push({ ts, text: m[1].trim() });
  }
  return out;
}

/** FEEDBACK.md sections are untriaged unless an explicit `## … — triage` marker section
 *  follows them, or they clearly predate the plan's last touch (day granularity — headers
 *  carry dates, not times, so a same-day section can't be ordered against `planMtime` and
 *  defaults to untriaged rather than risking an unrelated same-day PLAN.md edit silently
 *  hiding real feedback). */
export function feedbackInfo(dir: string, planMtime: number): FeedbackInfo | null {
  const fbPath = join(dir, 'FEEDBACK.md');
  const text = readIf(fbPath);
  if (text === null) return null;
  const sections = feedbackSections(text);
  const lessons = extractLessons(text);
  // a "triage" section marks everything before it as handled
  const lastTriage = sections.map((s) => /\btriage/i.test(s.header)).lastIndexOf(true);
  const planDay = planMtime ? localDay(planMtime) : '';
  const items = sections.filter((s, i) => {
    if (i <= lastTriage) return false;
    if (!s.ts) return !planMtime; // undated: untriaged only when there is no plan at all
    const day = localDay(s.ts + 12 * 3_600_000);
    return !planDay || day >= planDay;
  });
  return { sections: sections.length, untriaged: items.map((s) => s.header), items, lessons };
}
