import { readdirSync, statSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SessionInfo } from './types.js';

export function transcriptDirs(): string[] {
  if (process.env.BRIEF_PROJECTS) return process.env.BRIEF_PROJECTS.split(',').filter(Boolean);
  const dirs = [join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects')];
  const dev = join(homedir(), '.claude-dev', 'projects');
  if (!dirs.includes(dev) && existsSync(dev)) dirs.push(dev);
  return dirs;
}

/** Claude Code encodes the cwd as a slug: "/" → "-" (and "." → "-"). */
export function slugFor(path: string): string {
  return path.replace(/[/.]/g, '-');
}

export type SessionIndex = Map<string, SessionInfo>;

/** slug → {last, count7d} over every transcript dir. One pass, cached by caller. */
export function indexSessions(now: number, dirs = transcriptDirs()): SessionIndex {
  const idx: SessionIndex = new Map();
  const cutoff = now - 7 * 86_400_000;
  for (const d of dirs) {
    let slugs: string[];
    try {
      slugs = readdirSync(d);
    } catch {
      continue;
    }
    for (const slug of slugs) {
      const pdir = join(d, slug);
      let files: string[];
      try {
        files = readdirSync(pdir).filter((f) => f.endsWith('.jsonl'));
      } catch {
        continue;
      }
      const cur = idx.get(slug) ?? { last: 0, count7d: 0 };
      for (const f of files) {
        let m: number;
        try {
          m = statSync(join(pdir, f)).mtimeMs;
        } catch {
          continue;
        }
        if (m > cur.last) cur.last = m;
        if (m > cutoff) cur.count7d++;
      }
      idx.set(slug, cur);
    }
  }
  return idx;
}

export function sessionsFor(idx: SessionIndex, repoPath: string): SessionInfo {
  return idx.get(slugFor(repoPath)) ?? { last: 0, count7d: 0 };
}

/** Newest .jsonl transcript for a repo, across every transcript dir. */
export function newestTranscript(repoPath: string, dirs = transcriptDirs()): { file: string; ts: number } | null {
  const slug = slugFor(repoPath);
  let best: { file: string; ts: number } | null = null;
  for (const d of dirs) {
    const pdir = join(d, slug);
    let files: string[];
    try {
      files = readdirSync(pdir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) {
      const p = join(pdir, f);
      let ts: number;
      try {
        ts = statSync(p).mtimeMs;
      } catch {
        continue;
      }
      if (!best || ts > best.ts) best = { file: p, ts };
    }
  }
  return best;
}

/** Last assistant text block in a transcript — tail 64 KB, no full parse (sessions can be 100 MB).
 *  Skips tool_use-only assistant records; `turns` = assistant text replies, exact only when the
 *  whole file fit in the tail (else null — never a partial count). null if none found / unreadable. */
export function lastAssistantTail(file: string): { text: string; turns: number | null } | null {
  let data: string;
  let complete: boolean;
  try {
    const size = statSync(file).size;
    const len = Math.min(size, 64 * 1024);
    complete = len === size;
    const fd = openSync(file, 'r');
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    closeSync(fd);
    data = buf.toString('utf8');
  } catch {
    return null;
  }
  const lines = data.split('\n');
  let text: string | null = null;
  let turns = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let rec: { type?: string; message?: { content?: { type?: string; text?: string }[] } };
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.type !== 'assistant') continue;
    const block = rec.message?.content?.find((c) => c.type === 'text' && c.text);
    if (!block?.text) continue;
    turns++;
    text ??= block.text;
    if (!complete) break; // partial tail: the count would lie, stop at the newest text
  }
  return text ? { text, turns: complete ? turns : null } : null;
}

export function lastAssistantText(file: string): string | null {
  return lastAssistantTail(file)?.text ?? null;
}
