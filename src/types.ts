export interface GitInfo {
  branch: string;
  dirty: number; // modified/added/deleted (tracked)
  untracked: number;
  ahead: number; // unpushed commits (vs upstream)
  unpushedSince: number; // ms epoch of the oldest unpushed commit's author date, 0 if none/no upstream
  behind: number;
  noUpstream: boolean;
  lastCommitTs: number; // ms epoch, 0 if none
  lastCommitMsg: string;
  dirtyFiles: string[]; // paths, tracked+untracked (capped by caller)
  recent: string[]; // "abc1234 msg" × N
}

export interface DocInfo {
  file: string; // PLAN.md | STATE.md | STATUS.md | TODO.md
  mtime: number; // ms epoch (git-aware: last commit touching it, else fs mtime)
  open: number; // "- [ ]" count
  done: number; // "- [x]" count
  next: string[]; // best-effort "what's next" lines
  nextSource?: string; // set when `next` was borrowed from another file (CLAUDE.md fallback)
  commitsBehind: number; // commits to HEAD since the doc was last touched
}

export interface FeedbackSection {
  header: string;
  ts: number; // parsed date, 0 if undated
  preview: string; // first bullet/line of the body, trimmed
}

export interface FeedbackInfo {
  sections: number; // "## " sections total
  untriaged: string[]; // section headers newer than the plan doc (or all, if no plan)
  items: FeedbackSection[]; // the untriaged ones, with previews
  lessons: { ts: number; text: string }[]; // "- lesson: …" bullets, any section, triaged or not
}

export interface SessionInfo {
  last: number; // ms epoch of the newest transcript, 0 if none
  count7d: number;
}

export interface Repo {
  name: string; // "acme" or "acme/foo"
  path: string;
  description: string; // first para of CLAUDE.md/README.md
  git: GitInfo | null; // null = not a git repo
  docs: DocInfo[]; // present state docs, priority-ordered
  feedback: FeedbackInfo | null;
  sessions: SessionInfo;
  snuff: boolean;
  gates?: { ok: boolean; red: string[]; passed: number; total: number; ts?: number } | null; // live via `--gates`, else cached `~/.snuff/<slug>.json` / `<repo>/.snuff/last.json`; total excludes skipped
  tokens7d?: number; // last-7d tokens (input+output+cacheCreate) via `tally --json`, when tally is on PATH
  deadPaths: string[]; // backticked paths in CLAUDE.md that don't resolve, capped at 5
  runtime?: 'ok' | 'warn' | 'crit'; // pulse's last snapshot, when `.brief.yaml service:` is set
  lastSaid?: { text: string; ts: number; turns?: number }; // last session's final assistant text — handoff only, never the radar; turns only when the whole transcript was read
  score: number;
  reasons: string[]; // why it scored, short tags
}

export interface Report {
  root: string[];
  now: number;
  repos: Repo[];
}
