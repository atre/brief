import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Repo } from './types.js';

const execFileAsync = promisify(execFile);

interface TallyProject {
  project: string; // "git/acme"
  usage: { input: number; output: number; cacheRead: number; cacheCreate: number };
}

export interface TallyJson {
  byProject: TallyProject[];
}

export async function readTally(): Promise<TallyJson | null> {
  try {
    const { stdout } = await execFileAsync('tally', ['--json', '--since', '7d'], { timeout: 20_000 });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/** Match tally's `byProject[].project` (e.g. "git/acme") to a repo whose path is `<home>/<project>`. */
export function attachTokens(repos: Repo[], json: TallyJson | null, home: string): void {
  if (!json) return;
  const byPath = new Map(repos.map((r) => [r.path, r]));
  for (const p of json.byProject) {
    const repo = byPath.get(`${home}/${p.project}`);
    if (repo) repo.tokens7d = p.usage.input + p.usage.output + p.usage.cacheCreate;
  }
}

/** "1.6M" / "230.0k" — one decimal, k or M. */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}
