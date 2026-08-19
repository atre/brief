import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { STATE_DOCS } from './docs.js';

const SKIP = new Set(['node_modules', '.git', 'dist', 'archive']);

export interface Candidate {
  name: string;
  path: string;
  docsOnly?: boolean;
}

function isRepo(p: string): boolean {
  return existsSync(join(p, '.git'));
}

function listDirs(p: string): string[] {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIP.has(d.name))
      .map((d) => join(p, d.name))
      .sort();
  } catch {
    return [];
  }
}

/** Repos under `roots`: direct children that are git repos; a non-repo child that
 *  contains repos is descended one level (`acme/foo`). `exclude` are substrings.
 *  `docsRoots` (opt-in, separate from `roots`): each child dir carrying a state doc
 *  but no `.git` is added as a docs-only candidate — no git, no radar `commit` line. */
export function discover(roots: string[], exclude: string[] = [], docsRoots: string[] = []): Candidate[] {
  const out: Candidate[] = [];
  const skip = (name: string) => exclude.some((e) => e && name.includes(e));
  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) continue;
    if (isRepo(root)) {
      out.push({ name: basename(root), path: root });
      // a root that is itself an umbrella repo (acme/) still yields its nested repos
      for (const g of listDirs(root)) {
        if (isRepo(g) && !skip(basename(g))) out.push({ name: `${basename(root)}/${basename(g)}`, path: g });
      }
      continue;
    }
    for (const child of listDirs(root)) {
      const name = basename(child);
      if (skip(name)) continue;
      if (isRepo(child)) out.push({ name, path: child });
      // a repo that itself holds ≥2 repos (a work umbrella like acme/) is also a container
      const nested = listDirs(child).filter((g) => isRepo(g) && !skip(`${name}/${basename(g)}`));
      if (isRepo(child) && nested.length < 2) continue;
      for (const grand of nested) {
        out.push({ name: `${name}/${basename(grand)}`, path: grand });
      }
    }
  }
  for (const root of docsRoots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) continue;
    for (const child of listDirs(root)) {
      const name = basename(child);
      if (skip(name) || isRepo(child)) continue;
      if (STATE_DOCS.some((f) => existsSync(join(child, f)))) out.push({ name, path: child, docsOnly: true });
    }
  }
  return out;
}
