import { join } from 'node:path';
import type { Candidate } from './discover.js';
import { readConfig } from './config.js';
import { readIf, isAgentRunnable, nextItem, extractNext } from './docs.js';

export interface QueueRow {
  repo: string;
  path: string;
  planFile: string;
  line: number;
  done: number;
  open: number;
  next: string;
}

/** Repos whose PLAN/state doc carries the agent-runnable marker (or `.brief.yaml agentRunnable: true`). */
export function buildQueue(cands: Candidate[]): QueueRow[] {
  const rows: QueueRow[] = [];
  for (const c of cands) {
    const cfg = readConfig(c.path);
    const file = cfg.stateDoc ?? 'PLAN.md';
    const text = readIf(join(c.path, file));
    if (!text) continue;
    if (!cfg.agentRunnable && !isAgentRunnable(text)) continue;
    const { open, done } = extractNext(text, 1, false);
    const item = nextItem(text);
    const title = item?.text.split('\n')[0].replace(/^\s*[-*]\s+\[ \]\s*/, '').replace(/\*\*/g, '').trim() ?? '';
    rows.push({ repo: c.name, path: c.path, planFile: file, line: item?.line ?? 0, done, open, next: title });
  }
  return rows;
}
