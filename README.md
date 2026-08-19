# brief

[![CI](https://github.com/atre/brief/actions/workflows/ci.yml/badge.svg)](https://github.com/atre/brief/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Cross-repo state radar. Forty repos, five naming schemes for "where was I"
(PLAN/STATE/STATUS/TODO), append-only FEEDBACK files nobody triages, and a
workspace index that drifts — `brief` reads all of it and answers, in one
screen, *what needs attention* and *where to resume*.

Built so an AI session (or a human) starts a repo with the handoff already
written, and so half-done work stops going cold unnoticed.

## Install

Node ≥ 20. Straight from GitHub (not on npm):

```bash
npm install -g github:atre/brief
```

Or from source: `git clone … && cd brief && npm install && npm link`.

## Usage

```
brief                     # radar: every repo under ~/git ranked by attention (top 10)
brief svc-a               # handoff for one repo (name, "acme/foo", or a path)
brief svc-a --next        # just the repo's first open PLAN.md item ("PLAN.md:7" + text), exit 1 if none
brief svc-a --gates       # handoff + live `snuff --json --changed` → "gates: ✓ 3/3" / "gates: ✗ 1/3 — lint" (repo command only)
brief --hub               # diff discovered repos vs ~/git/hub/CLAUDE.md table
brief --hub --write       # append missing repos as rows above the "No index yet" row (curated rows untouched)
brief feedback            # every untriaged FEEDBACK.md section across repos, one preview line each
brief feedback --lessons  # "- lesson: …" bullets across all repos, any section · --md for a table for LESSONS.md
brief queue               # repos whose PLAN/state doc is agent-runnable: <repo> PLAN d/n ↳ next item · --json
brief snap [name]         # write a workspace snapshot to ~/.brief/snaps/<name>.json (default "last")
brief diff [name]         # diff the current radar against a snapshot: new/gone/changed repos, score deltas
brief init [dir]          # wire a SessionStart hook (`brief . --tokens 800`) into <dir>/.claude/settings.json
brief --all --json        # everything, machine-readable · --md for a digest table
brief --root ~/work --root ~/git --exclude worktree --top 15 --only acme/ --stale 3
brief --docs-root ~/Documents      # opt-in: non-git dirs with a state doc join the radar, no commit line
brief --brief                      # hook mode: top 3, 2 lines/repo, hard cap 15 lines
```

Radar:

```
brief — 37 repos · 30 dirty · 4 unpushed · 6 with untriaged FEEDBACK · 14 active (7d)
svc-a     31  30 dirty · 2 unpushed · TODO.md 19c stale
              1 sess/7d · last 16h · commit 7min · TODO.md 5mo 43 open
              ↳ retry logic — fallback path runs but yields 0 rows; decide keep/drop …
repo-b    16  4 dirty · 4 unpushed · 1 untriaged feedback
              no sessions · commit 3d
demo-project 14  2 dirty · 4 untriaged feedback
              1 sess/7d · last 11h · commit 11h · PLAN.md 11h 12 open
              ↳ $ estimate per model (opt-in table in a `pricing.json` …)
below the fold: tool-x 14, tool-y 12, tool-z 12, side-project-w 11 … +20
quiet: 24 (--all to list)
```

Handoff (`brief demo-project`, ~1,200 tokens by default, `--tokens` to trim):

```
# demo-project — Example background worker for the home lab — job runner notes, deploy TODO …
git: feature-branch · 52 modified + 1 untracked · no upstream · last commit 11h "Session 22 CLOSED …"
sessions: 22 in 7d · last 1min · snuff: no
last session said: Stopped at step 3; lint still red (1min)
docs: STATE.md 2min · PLAN.md 11h
next (STATE.md):
  - …
dirty (53):
  src/ ×37
  tools/ ×13
recent commits:
  a1b2c3d Session 22 CLOSED: batch job lands, cleanup pass complete
```

## What it reads (all local, read-only)

| signal | source |
|---|---|
| dirty / untracked / unpushed / behind, branch, recent commits | `git status --porcelain=v2 --branch`, `git log` |
| description | first real paragraph of README.md, else CLAUDE.md (agent boilerplate skipped) |
| primary state doc + "next" | first of `STATE.md · STATUS.md · TODO.md · PLAN.md`: bullets under a `## Next`/`resume`/`now`/`todo` heading, else open `- [ ]` items, else CLAUDE.md checkboxes |
| doc drift | commits on HEAD after the commit that last touched the state doc (`Nc stale`) |
| untriaged feedback | `FEEDBACK.md` `## <date>` sections after PLAN.md's last-touch day (same day counts when FEEDBACK.md was written later); a `## … triage` section marks everything before it handled |
| sessions | Claude Code transcripts (`~/.claude/projects`, `~/.claude-dev/projects`; env `BRIEF_PROJECTS`) — count in 7d, last |
| snuff | `snuff.yaml` present |
| dead CLAUDE.md paths | backticked paths in CLAUDE.md that no longer resolve, capped at 5 — relative paths tried at the root, then anywhere in the tree (depth ≤ 4); `~/`, `/Users/` paths checked as-is; CIDRs, regexes, URL paths, flag pairs, `Next.js`-style names, runtime `*.json` never count |
| gates | snuff's last result: `~/.snuff/<slug>.json`, else the in-repo `<repo>/.snuff/last.json` snuff writes today (ISO `ts`, `gates[].gate.name` — both shapes accepted); `--gates` runs snuff live for one repo |
| runtime | pulse's last snapshot (`~/.pulse/snaps/last.json`) joined on `.brief.yaml service:` — ids `k8s:<ns>/<name>`, `cron:<ns>/<name>`, `site:<url>` matched exactly; `pvc:`/`node:`/`host:`/`disk:` findings are not repo-attributable and never join |
| PLAN progress | `PLAN d/total` from PLAN.md checkboxes; its first open item backs `↳ next` when the primary state doc has none |
| tokens (7d) | `tally --json --since 7d`, when `tally` is on PATH — shown, not scored |

Score = dirty (≤20) + unpushed (5+n) + behind (2) + **stale-dirty Nd** (+8: dirty and no
session in `--stale` days, default 7 — half-done work going cold) + primary doc stale
(5 commits +4, 20 +8) + untriaged FEEDBACK (3 each, ≤12) + **gates ✗** (+4: snuff's last
result for the repo has a red gate, from `~/.snuff/<slug>.json` or `<repo>/.snuff/last.json` —
cached, no subprocess in the radar) + **gates stale** (+2: last snuff run older than 3d) + **dead CLAUDE.md paths**
(1 each, ≤5) + **runtime ✗** (+6) / **runtime ⚠** (+2, from pulse's last snapshot, when
`.brief.yaml service:` is set) + **unpushed Nd** (+1: oldest unpushed commit older than
3d — work sitting local a while). Score 0 = quiet. The number is a sort key, not a grade.

## Per-repo overrides — `.brief.yaml`

Zero-config by default; for repos with their own conventions:

```yaml
stateDoc: docs/actions-dev.md   # primary state doc (relative path); default STATE/STATUS/TODO/PLAN.md
nextHeading: Open items         # heading cue for "next" (case-insensitive substring)
description: one line           # override the README/CLAUDE.md pick
ignore: true                    # drop the repo from the radar
service: app/svc-a              # pulse finding id this repo owns (k8s:<ns>/<name>, cron:<ns>/<name>, site:<url>) — runtime: line
                                # pvc:/node:/host:/disk: findings are cluster-level, not repo-attributable — no join
```

## Wiring

- Hub / workspace repo `SessionStart` hook: `brief --brief` — top 3, 2 lines/repo, hard-capped at 15 lines total, the radar lands where the day starts without blowing the hook budget.
- Per repo: `brief init` wires `brief . --tokens 800` as a SessionStart hook — the handoff is on screen before the first prompt (keep STATE.md for the *why*; brief does the *what*).
- `brief feedback` is the consumer for append-only FEEDBACK.md files: triage, then touch PLAN.md (or add a `## <date> — triage` section) and they drop off.
- `npm run report` (or the `/weekly` skill) writes `reports/YYYY-WW.md` in this repo — the Monday view; no scheduler in code, invoked by hand.
- Skills in `skills/`: `brief` (the CLI), plus composition skills `start` (session kickoff across the fleet), `triage` (FEEDBACK → PLAN/LESSONS), `weekly` (reports/YYYY-WW.md) — symlink each into `~/.claude/skills/`.

## Stack

TypeScript, Node ≥ 20, ESM. Roadmap in `PLAN.md`.
