---
name: weekly
description: Weekly review across the workspace — repo radar changes, token spend, runtime health, feedback backlog — written to reports/YYYY-WW.md inside each tool repo (never to Notion). TRIGGER on "weekly", "week review", "Monday view", "what happened this week", or when the current ISO week has no report yet.
---

# /weekly

`WEEK=$(date +%G-W%V)`; write files, then summarize.

```sh
mkdir -p ~/git/brief/reports ~/git/tally/reports ~/git/pulse/reports
brief --md --top 15                          > ~/git/brief/reports/$WEEK.md    # then `brief diff weekly` (delta since last week) and `brief snap weekly`
tally --md --since 7d                        > ~/git/tally/reports/$WEEK.md
pulse --md                                   > ~/git/pulse/reports/$WEEK.md
brief feedback                               >> ~/git/brief/reports/$WEEK.md   # untriaged backlog appended to the brief report
```

Then read the three files (they're already digests — no further trimming) and produce, in chat, **at most 15 lines**:
1. Top 3 repos needing attention and why (from brief: stale-dirty, unpushed, doc drift).
2. The one token leak worth fixing (from tally: long-context first, then the top bucket).
3. Runtime: crit/warn count, or "green".
4. Feedback: untriaged count → propose `/triage` if > 5.
5. Unpushed repos count → propose `pushall` (explicit; never push on your own).
6. Deltas (`~/git/docs/ai/deltas.md`): new `△` lines this week; `status: open` older than ~3 weeks → mark `dropped` (or propose escalation to a PLAN item); confirmed habit changes → mark `adopted`. Mutate statuses in place.
7. Drift: brief/tally actuals vs `~/Documents/Business/STATUS.md` critical path — one line `stated … / actual …`. Allocation only, never pace (no-deadlines rule); the day-job repo is exempt.
8. Decisions due: `grep -H 'Revisit:' ~/Documents/Business/decisions/*.md` → any date ≤ today: one line predicted vs actual each (record the comparison in that day's Business `journal/`; decision files stay immutable).
9. Kill-or-commit: repos brief flags stale-dirty with 0 sessions/7d → propose kill/archive/commit, max 2 candidates. Propose only — never act on it.

10. Verbosity: `tally verbosity --since 7d --md >> ~/git/tally/reports/$WEEK.md`. Keep the window at 7d — it's the window the recorded baseline used, and a wider one silently reads better. The baseline, the target and the revisit date live in `~/git/docs/ai/notes/` (grep `Expected:` there); report the current over-budget % and its delta against that baseline in one line. Not falling by the revisit date → the brevity rule isn't landing on its own; propose enforcement (a lower `TALLY_VERBOSITY_BUDGET`, or per-repo budgets) instead of re-reporting the same number. Target met → mark the prediction hit in that note and drop this step.

11. Transcript secrets: `gitleaks dir ~/.claude/projects --no-banner --redact --max-target-megabytes 200 --baseline-path <last sweep's report> -f json -r <scratchpad>/gl.json` — repeat for `~/.claude-dev/projects` if that instance exists. Session transcripts are plaintext and keep whatever was pasted or `cat`-ed into them; nothing else scans them. The baseline is the previous sweep's own redacted report (kept in `~/git/docs/ai/notes/`) — redacted reports work as baselines, so only findings NEW since it are reported. Report rule + count + `file:line`, never a value. Remediation is **rotate what's live**, not scrub: transcripts are append-only, editing them breaks resume/compact, and copies are already in backups. Sweep clean → replace the baseline with the new report so next week starts from here. Skip the whole step if `gitleaks` isn't installed.

Rules: reports are the record, chat is the summary — don't paste reports back. If a tool is missing (`command -v` fails), skip its file and say so. Don't commit the reports unless told (they're inside each tool repo; `reports/` may be gitignored per repo — respect it).
