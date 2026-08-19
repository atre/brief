---
name: brief
description: Cross-repo state radar and per-repo session handoff via the globally installed `brief` CLI. TRIGGER on "where was I", "what's pending / half-done across my repos", "what should I work on", "hand me off / catch me up on <repo>", "is the hub index stale", or at the start of work in any repo when there is no STATE.md to read. SKIP for token/cost questions (tally) and log triage (squirt).
---

# brief — where was I

```sh
brief                 # radar: repos ranked by attention (dirty, unpushed, stale-dirty, doc drift, untriaged FEEDBACK)
brief --brief         # hook mode: top 3, 2 lines/repo, ≤ 15 lines, ends with "… +N more"
brief <repo>          # handoff for one repo: git state, sessions, docs + next, dirty files, recent commits (~1.2k tokens; --tokens 600 to trim)
brief <repo> --next   # only the first open PLAN item ("PLAN.md:7" + text), exit 1 if none
brief <repo> --gates  # handoff + live snuff run → "gates: ✓ 3/3" / "gates: ✗ 1/3 — lint" (radar never runs snuff; it reads snuff's last result)
brief --hub           # hub CLAUDE.md table vs reality: missing rows, gone dirs, non-git dirs
brief --hub --write   # append missing repos as rows above the "No index yet" row, rebuild that row (curated rows untouched)
brief feedback        # untriaged FEEDBACK.md sections across repos (preview each) — the triage list
brief feedback --lessons  # "- lesson:" bullets across repos (--md for LESSONS.md)
brief queue           # repos whose PLAN is agent-runnable, with the next item
brief snap [name] / brief diff [name]   # workspace snapshot to ~/.brief/snaps, and the delta since
brief init [dir]      # SessionStart hook `brief .` for a repo
brief --docs-root ~/Documents          # non-git dirs with a state doc join the radar
brief --all | --json | --md · --only acme/ · --top 15 · --stale 3
```

Rules for using it:
1. Starting work in a repo → `brief <repo>` first, then read what it points at (STATE/PLAN section, the dirty files) — don't `cat` whole docs.
2. "What should I do next" across repos → `brief`, lead with the top 3 rows and their `↳ next` line; don't paste the whole radar back.
3. Reason tags are the explanation: `stale-dirty` = dirty and no session in 7d (work going cold), `PLAN.md 20c stale` = 20 commits since the plan was touched, `N untriaged feedback` = FEEDBACK.md sections newer than the plan.
4. Score 0 = quiet; the number is a sort key, not a grade. Never fabricate a "next" when brief shows none — say the repo has no state doc.
5. `--hub` output rows are paste-ready candidates for the hub table; the user curates. brief writes only when told: `--hub --write` (hub table rows) and `snap` (`~/.brief/snaps`) — never into repos.
6. Triage flow: `brief feedback` → act on / fold items into the tool's PLAN.md → touch PLAN.md or add a `## <date> — triage` section in FEEDBACK.md; the sections drop off.
7. A repo with odd conventions → suggest a `.brief.yaml` (stateDoc / nextHeading / description / ignore) instead of guessing.
