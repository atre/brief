# brief

Cross-repo state radar over a workspace of git repos (default `~/git`, one-level
containers like `acme/*` included). Output is a compact ranked digest (radar), a
per-repo handoff, or a hub-table diff. Keep it a digest — guard compactness the
way squirt/tally do; every line must earn its place at session start.

## Stack
- TypeScript 5.x, Node ≥ 20, ESM only. No runtime deps today by accident, not by rule — add one when it earns its keep.
- Read-only. Never writes into repos; never sends data anywhere.

## Commands
- `npm run build` / `npm test` / `npm run lint`; `snuff` = definition of done (Stop hook runs it).
- `node dist/index.js` runs against the real workspace; tests build fixture repos in tmp with real `git init`.

## Architecture (18 files under `src/`)
- `src/index.ts` — entry: dispatch on `cli` cmd (radar / repo / hub / feedback / queue / snap / diff / init), token budget → list sizes.
- `src/cli.ts` — hand-rolled args (`--brief` sets top 3, `--gates` repo-only, `--write` hub-only) + HELP text.
- `src/types.ts` — `Repo`, `Report`, `DocInfo`, `FeedbackInfo`, `SessionInfo`, `GitInfo` shapes.
- `src/discover.ts` — roots → repos (direct git children; non-repo containers and umbrella repos with ≥2 nested repos descend one level; `--exclude` substrings, default `worktree`; `--docs-root` non-git dirs with a state doc).
- `src/config.ts` — `.brief.yaml` per-repo overrides (flat subset of YAML: stateDoc / nextHeading / description / ignore / service / agentRunnable).
- `src/git.ts` — `gitInfo` (porcelain v2 + branch ab), `lastTouched(file)` → {ts, hash}, `commitsSince(hash)` = `rev-list --count hash..HEAD` (topological, not timestamps).
- `src/docs.ts` — `describe` (README first, then CLAUDE.md; paragraph-aware; `BOILERPLATE` skips agent instructions), `extractNext` (next-ish heading bullets → open checkboxes → first prose line; `Next.js` is not a cue), `docInfos` (STATE_DOCS priority, case-insensitive dedupe), `feedbackInfo` (dated `##` sections newer than plan = untriaged), `deadPaths` (backticked CLAUDE.md paths that resolve nowhere: root, then a depth-≤4 walk; `~/`/`/Users/` as-is; CIDR/regex/URL/flag/product-name/runtime-json tokens skipped — quiet-wrong policy), `nextItem`, `extractLessons`.
- `src/sessions.ts` — Claude Code transcript index: slug = cwd with `/` and `.` → `-`; `~/.claude/projects` + `~/.claude-dev/projects` (env `BRIEF_PROJECTS`); `lastAssistantTail` reads a 64 KB tail (turns count only when the whole file fit).
- `src/gates.ts` — snuff last result: `~/.snuff/<slug>.json` first, else `<repo>/.snuff/last.json` (ISO ts, nested `gate.name`); both normalised to `{ts, ok, gates[{name, ok, skipped}]}`.
- `src/runtime.ts` — pulse last snapshot (`~/.pulse/snaps/last.json`) → `runtimeFor(service, findings)`; ids `k8s:/cron:/site:` only; `service` is comma-separated, trailing `*` = prefix match (cron families); worst severity across all matches wins.
- `src/tokens.ts` — `tally --json --since 7d` join by project path; `fmtTokens`.
- `src/score.ts` — attention score + reason tags (the tags ARE the explanation; keep them ≤ 3 words each).
- `src/collect.ts` — assembles `Repo` (8-way concurrency); CLAUDE.md checkbox fallback for `next`; gates summary (`passed/total`, skipped excluded).
- `src/hub.ts` — parse hub CLAUDE.md table names (`` `x` ``, `` `~/git/x` ``, `` `a` / `b` ``, comma lists) → missing / gone / notRepo; `applyHubWrite` (rows above the "No index yet" row, rebuild/remove that row, everything else byte-identical).
- `src/queue.ts` — agent-runnable PLAN docs (`How to run this plan` marker or `.brief.yaml agentRunnable`) → `<repo> PLAN d/n ↳ next`.
- `src/snap.ts` — `~/.brief/snaps/<name>.json` write/read + `diffSnaps` (new/gone/changed, score deltas).
- `src/init.ts` — merge a SessionStart hook (`brief . --tokens 800`) into `.claude/settings.json`, idempotent.
- `src/render.ts` — radar text (2–3 lines per repo, fold + quiet lines; `--brief` ≤ 15 lines ending with `… +N more`), handoff (`--tokens` budget → list sizes; `gates: ✓ 3/3`), `--md`, hub / queue / diff / lessons renders.

## Rules
- New signal → add to `score.ts` deliberately (tag + weight + README table row) and cover with a fixture test.
- Heuristics over prose are allowed to be wrong quietly, never loudly: prefer "no next" over a bad guess.
- Roadmap in PLAN.md; usage friction from other repos goes to FEEDBACK.md (gitignored, local).
