#!/usr/bin/env node
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { parseArgs, HELP } from './cli.js';
import { collect, collectOne, runSnuff } from './collect.js';
import { renderText, renderRepo, renderMd, renderHub, renderFeedback, renderLessons, renderLessonsMd, renderQueue, renderDiff } from './render.js';
import { buildQueue } from './queue.js';
import { writeSnap, readSnap, toSnap, diffSnaps } from './snap.js';
import { cmdInit } from './init.js';
import { hubDiff, applyHubWrite } from './hub.js';
import { discover } from './discover.js';
import { readConfig } from './config.js';
import { readIf, nextItem } from './docs.js';

const pkg = createRequire(import.meta.url)('../package.json') as { version: string };

async function main(): Promise<void> {
  const home = homedir();
  const args = parseArgs(process.argv.slice(2), home);
  const now = Date.now();
  if (args.cmd === 'help') return void console.log(HELP);
  if (args.cmd === 'version') return void console.log(pkg.version);
  if (args.cmd === 'init') {
    process.exitCode = cmdInit(resolve(args.target ?? '.'));
    return;
  }

  if (args.cmd === 'queue') {
    const cands = discover(args.roots, args.exclude, args.docsRoots).filter((c) => !args.only || c.name.includes(args.only));
    const rows = buildQueue(cands);
    if (args.json) return void console.log(JSON.stringify(rows, null, 2));
    return void console.log(renderQueue(rows));
  }

  if (args.cmd === 'repo') {
    const t = args.target!;
    let path: string | undefined;
    if (existsSync(t) && statSync(t).isDirectory()) path = resolve(t);
    else {
      const cands = discover(args.roots, args.exclude, args.docsRoots);
      const hit = cands.find((c) => c.name === t) ?? cands.find((c) => basename(c.name) === t) ?? cands.find((c) => c.name.includes(t));
      path = hit?.path;
    }
    if (!path) throw new Error(`no repo matching "${t}" under ${args.roots.join(', ')}`);
    if (args.next) {
      const cfg = readConfig(path);
      const file = cfg.stateDoc ?? 'PLAN.md';
      const text = readIf(join(path, file));
      const item = text ? nextItem(text) : null;
      if (!item) {
        console.error('no open PLAN item');
        process.exitCode = 1;
        return;
      }
      console.log(`${file}:${item.line}`);
      console.log(item.text);
      return;
    }
    const repo = await collectOne(nameFor(path, args.roots), path, now, undefined, args.stale, { ...(args.gates ? { gates: runSnuff } : {}), lastSaid: true });
    if (!repo) throw new Error(`${path} is ignored by its .brief.yaml`);
    if (args.json) return void console.log(JSON.stringify(repo, null, 2));
    const budget = budgetFor(args.tokens ?? 1200);
    return void console.log(renderRepo(repo, now, budget));
  }

  const rep = await collect({ roots: args.roots, docsRoots: args.docsRoots, exclude: args.exclude, now, only: args.only, staleDays: args.stale });
  if (args.cmd === 'snap') {
    const file = writeSnap(rep, args.target ?? 'last');
    return void console.log(`brief snap: wrote ${rep.repos.length} repos to ${file}`);
  }
  if (args.cmd === 'diff') {
    const name = args.target ?? 'last';
    const prev = readSnap(name);
    if (!prev) throw new Error(`no snapshot named "${name}" — run \`brief snap ${name}\` first`);
    const diff = diffSnaps(prev, toSnap(rep));
    if (args.json) return void console.log(JSON.stringify(diff, null, 2));
    return void console.log(renderDiff(diff, prev.ts, now));
  }
  if (args.cmd === 'feedback') {
    if (args.lessons) {
      if (args.json) return void console.log(JSON.stringify(rep.repos.flatMap((r) => r.feedback?.lessons.map((l) => ({ repo: r.name, ...l })) ?? []), null, 2));
      return void console.log(args.md ? renderLessonsMd(rep) : renderLessons(rep));
    }
    if (args.json) return void console.log(JSON.stringify(rep.repos.filter((r) => r.feedback?.items.length).map((r) => ({ name: r.name, path: r.path, items: r.feedback!.items })), null, 2));
    return void console.log(renderFeedback(rep));
  }
  if (args.cmd === 'hub') {
    const file = args.hubFile ?? `${home}/git/hub/CLAUDE.md`;
    const diff = hubDiff(file, rep.repos, args.roots);
    if (args.write) {
      const before = readFileSync(file, 'utf8');
      const w = applyHubWrite(before, diff);
      if (w.text !== before) writeFileSync(file, w.text);
      const note = { unchanged: '', rebuilt: ', no-index row rebuilt', removed: ', no-index row removed (empty)', absent: ', no "No index yet" row — nothing written' }[w.noIndex];
      return void console.log(`hub: +${w.rows} rows${note}`);
    }
    return void console.log(args.json ? JSON.stringify(diff, null, 2) : renderHub(diff));
  }
  if (args.json) return void console.log(JSON.stringify(rep, null, 2));
  if (args.md) return void console.log(renderMd(rep, args.top));
  console.log(renderText(rep, { top: args.top, all: args.all, brief: args.brief }));
}

function nameFor(path: string, roots: string[]): string {
  for (const r of roots) {
    const abs = resolve(r);
    if (path.startsWith(`${abs}/`)) return path.slice(abs.length + 1);
  }
  return basename(path);
}

/** Rough token budget → list sizes (a line ≈ 12 tokens; header block ≈ 150). */
function budgetFor(tokens: number): { files: number; commits: number; next: number; lastSaid: 'full' | 'trim' | 'drop' } {
  const lines = Math.max(6, Math.floor((tokens - 150) / 12));
  return {
    next: Math.min(8, Math.max(3, Math.floor(lines * 0.25))),
    files: Math.min(25, Math.max(4, Math.floor(lines * 0.45))),
    commits: Math.min(8, Math.max(3, Math.floor(lines * 0.2))),
    lastSaid: tokens < 300 ? 'drop' : tokens < 600 ? 'trim' : 'full',
  };
}

main().catch((err: unknown) => {
  console.error(`brief: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
