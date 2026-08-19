import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Repo } from './types.js';

export interface HubDiff {
  missing: Repo[]; // discovered, not in the table
  gone: string[]; // in the table, dir does not exist
  notRepo: string[]; // in the table, dir exists but is not a git repo (or excluded)
  listed: number;
}

/** Repo names in a hub CLAUDE.md: `| \`name\` | …` rows and the comma-list "no index yet" row. */
export function tableNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cell = line.split('|')[1]?.trim() ?? '';
    for (const m of cell.matchAll(/`([^`]+)`/g)) {
      const raw = m[1].trim();
      if (raw.includes(' ')) continue;
      if (raw.startsWith('~')) {
        // `~/git/acme` → acme ; `~/Documents/Notes` → not a repo name we track
        const parts = raw.split('/');
        if (parts[1] === 'git' && parts[2]) names.add(parts[2]);
        continue;
      }
      // `microservice-go` / `microservice-python` style cells
      for (const part of raw.split('/')) if (part && !part.includes('*')) names.add(part);
    }
  }
  return names;
}

export interface HubWrite {
  text: string;
  rows: number; // rows inserted
  noIndex: 'unchanged' | 'rebuilt' | 'removed' | 'absent'; // what happened to the "No index yet" row
}

/**
 * Insert a `| \`name\` | description |` row for each of `diff.missing` directly above the
 * "No index yet" row, and rebuild that row's comma list without the names that now have their
 * own row (row removed when the list becomes empty). Every other line is left byte-identical.
 * Idempotent: once a repo has its own row, a fresh `hubDiff` no longer reports it as missing,
 * so a repeat call is a no-op.
 */
export function applyHubWrite(text: string, diff: HubDiff): HubWrite {
  const lines = text.split('\n');
  const noIndexIdx = lines.findIndex((l) => l.startsWith('|') && /No index yet/i.test(l));
  if (noIndexIdx === -1) return { text, rows: 0, noIndex: 'absent' };
  if (!diff.missing.length) return { text, rows: 0, noIndex: 'unchanged' };
  const missingNames = new Set(diff.missing.map((r) => r.name));
  const cells = lines[noIndexIdx].split('|');
  const names = [...cells[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const kept = names.filter((n) => !missingNames.has(n));
  const rows = diff.missing.map((r) => `| \`${r.name}\` | ${r.description || '—'} |`);
  let noIndex: HubWrite['noIndex'] = 'unchanged';
  if (!kept.length) {
    lines.splice(noIndexIdx, 1, ...rows);
    noIndex = 'removed';
  } else {
    if (kept.length !== names.length) {
      cells[1] = ` ${kept.map((n) => `\`${n}\``).join(', ')} `;
      lines[noIndexIdx] = cells.join('|');
      noIndex = 'rebuilt';
    }
    lines.splice(noIndexIdx, 0, ...rows);
  }
  return { text: lines.join('\n'), rows: rows.length, noIndex };
}

export function hubDiff(hubPath: string, repos: Repo[], roots: string[]): HubDiff {
  const text = readFileSync(hubPath, 'utf8');
  const listed = tableNames(text);
  const discovered = new Map(repos.map((r) => [r.name.split('/')[0], r]));
  const missing: Repo[] = [];
  for (const r of repos) if (!r.name.includes('/') && !listed.has(r.name)) missing.push(r);
  const gone: string[] = [];
  const notRepo: string[] = [];
  for (const n of listed) {
    if (n === 'hub' || discovered.has(n)) continue;
    if (roots.some((root) => existsSync(join(root, n)))) notRepo.push(n);
    else gone.push(n);
  }
  return { missing, gone, notRepo, listed: listed.size };
}
