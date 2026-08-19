---
name: start
description: Session kickoff for any repo — one screen from the tool fleet (brief handoff, pulse runtime, snuff gates, tally trace) before the first edit. TRIGGER on "start", "catch me up", "where was I in <repo>", "let's continue in <repo>", or when a session opens in a repo with no STATE.md. SKIP inside hub (its SessionStart hook already prints the radars).
---

# /start [repo]

Composition of existing CLIs — run them, read them, don't re-derive.

```sh
brief <repo|.> --tokens 900          # handoff: description, git, sessions, state doc + next, dirty files, commits
pulse --brief                        # runtime: prints only crit/warn (silent = green)
snuff --changed --quiet 2>&1 | head  # gates: silent = green (only if snuff.yaml exists)
tally trace -p <repo-slug> 2>/dev/null | tail -3   # last session's tail (ctx, last tool) — optional
```

Then, in this order:
1. Open only what brief's `next` and `dirty` lines point at (the state doc section, the dirty files) — never `cat` whole PLAN/STATE files.
2. If pulse printed anything crit for a service this repo owns → that's the first task; use its hint command, pipe logs through `squirt`.
3. If snuff is red → fix or explicitly park it before new work.
4. Say in 3 lines: where we are, what's next, what's blocking. Then work.

Rules: no fabricated "next" (if brief shows none, say the repo has no state doc and propose a `.brief.yaml stateDoc:`); don't paste the tool output back — quote the lines that matter.
