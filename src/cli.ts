export interface Args {
  cmd: 'radar' | 'repo' | 'hub' | 'feedback' | 'init' | 'queue' | 'snap' | 'diff' | 'help' | 'version';
  target?: string;
  roots: string[];
  docsRoots: string[];
  exclude: string[];
  top: number;
  all: boolean;
  json: boolean;
  md: boolean;
  only?: string;
  hubFile?: string;
  tokens?: number;
  stale: number;
  write: boolean;
  gates: boolean;
  brief: boolean;
  lessons: boolean;
  next: boolean;
}

export const HELP = `brief — cross-repo state radar

usage
  brief                      rank every repo under ~/git by attention needed (top 10)
  brief <repo>               fresh-session handoff for one repo (name or path)
  brief <repo> --next        print the repo's first open PLAN.md item (path:line + text), exit 1 if none
  brief --hub [file]         diff discovered repos vs the hub CLAUDE.md table (default ~/git/hub/CLAUDE.md)
  brief --hub [file] --write append missing repos as rows above the "No index yet" row (curated rows untouched)
  brief feedback             untriaged FEEDBACK.md sections across all repos, with a preview line each
  brief feedback --lessons   "- lesson: …" bullets across all repos (any section, triaged or not)
  brief queue                repos whose PLAN/state doc is agent-runnable: <repo> PLAN d/n ↳ next item
  brief snap [name]          write a workspace snapshot to ~/.brief/snaps/<name>.json (default "last")
  brief diff [name]          diff the current radar against a snapshot (default "last")
  brief init [dir]           wire a Claude Code SessionStart hook (brief . --tokens 800) into <dir>/.claude/settings.json

flags
  --root <dir>       workspace root(s), repeatable (default ~/git; env BRIEF_ROOTS comma-list)
  --docs-root <dir>  non-git dirs to scan for state docs, repeatable, opt-in (env BRIEF_DOCS_ROOTS comma-list)
  --exclude <sub>    skip repo names containing <sub>, repeatable (default: worktree)
  --top <n>          rows in the radar (default 10)
  --brief            hook-mode radar: top 3 (unless --top given), 2 lines/repo, hard cap 15 lines
  --all              show quiet repos too
  --only <sub>       only repos whose name contains <sub>
  --json | --md      machine / markdown output
  --tokens <n>       trim the handoff to roughly n tokens (default 1200)
  --stale <days>     stale-dirty threshold: dirty and no session in <days> (default 7)
  --gates            "brief <repo>" only: run snuff --json --changed and show a gates: line
  -h, --help · -v, --version

score = dirty files (≤20, or +2 flat if dormant) + unpushed (5+n) + behind (+2)
      + stale-dirty (+8, dirty and no session in --stale days; skipped if dormant)
      + dormant tag (no commit AND no session in 180d — caps dirty instead of stacking with stale-dirty)
      + primary doc stale (5c:+4, 20c:+8) + untriaged FEEDBACK sections (3 each, ≤12)
per-repo overrides: .brief.yaml — stateDoc, nextHeading, description, ignore
`;

export function parseArgs(argv: string[], home: string): Args {
  const a: Args = {
    cmd: 'radar',
    roots: [],
    docsRoots: [],
    exclude: [],
    top: 10,
    all: false,
    json: false,
    md: false,
    stale: 7,
    write: false,
    gates: false,
    brief: false,
    lessons: false,
    next: false,
  };
  let topGiven = false;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const next = () => argv[++i] ?? '';
    if (x === '-h' || x === '--help') a.cmd = 'help';
    else if (x === '-v' || x === '--version') a.cmd = 'version';
    else if (x === '--hub') {
      a.cmd = 'hub';
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) a.hubFile = argv[++i];
    } else if (x === '--write') a.write = true;
    else if (x === '--gates') a.gates = true;
    else if (x === '--root') a.roots.push(next());
    else if (x === '--docs-root') a.docsRoots.push(next());
    else if (x === '--exclude') a.exclude.push(next());
    else if (x === '--top') {
      a.top = Number(next()) || 10;
      topGiven = true;
    } else if (x === '--brief') a.brief = true;
    else if (x === '--lessons') a.lessons = true;
    else if (x === '--next') a.next = true;
    else if (x === '--all') a.all = true;
    else if (x === '--only') a.only = next();
    else if (x === '--json') a.json = true;
    else if (x === '--md') a.md = true;
    else if (x === '--tokens') a.tokens = Number(next()) || undefined;
    else if (x === '--stale') a.stale = Number(next()) || 7;
    else if (x.startsWith('-')) throw new Error(`unknown flag ${x}`);
    else positional.push(x);
  }
  if (a.write && a.cmd !== 'hub') throw new Error('--write is only valid with --hub');
  if (!a.roots.length) a.roots = (process.env.BRIEF_ROOTS ?? `${home}/git`).split(',').filter(Boolean);
  if (!a.docsRoots.length && process.env.BRIEF_DOCS_ROOTS) a.docsRoots = process.env.BRIEF_DOCS_ROOTS.split(',').filter(Boolean);
  if (!a.exclude.length) a.exclude = ['worktree'];
  if (positional[0] && a.cmd === 'radar') {
    if (positional[0] === 'feedback') a.cmd = 'feedback';
    else if (positional[0] === 'queue') a.cmd = 'queue';
    else if (positional[0] === 'snap') {
      a.cmd = 'snap';
      a.target = positional[1] ?? 'last';
    } else if (positional[0] === 'diff') {
      a.cmd = 'diff';
      a.target = positional[1] ?? 'last';
    } else if (positional[0] === 'init') {
      a.cmd = 'init';
      a.target = positional[1] ?? '.';
    } else {
      a.cmd = 'repo';
      a.target = positional[0];
    }
  }
  if (a.gates && a.cmd !== 'repo') throw new Error('--gates is only valid for `brief <repo>`');
  if (a.lessons && a.cmd !== 'feedback') throw new Error('--lessons is only valid for `brief feedback`');
  if (a.next && a.cmd !== 'repo') throw new Error('--next is only valid for `brief <repo>`');
  if (a.brief && !topGiven) a.top = 3;
  return a;
}
