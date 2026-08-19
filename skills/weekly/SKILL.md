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

Then read the three files (they're already digests — no further trimming) and produce, in chat, **at most 10 lines**:
1. Top 3 repos needing attention and why (from brief: stale-dirty, unpushed, doc drift).
2. The one token leak worth fixing (from tally: long-context first, then the top bucket).
3. Runtime: crit/warn count, or "green".
4. Feedback: untriaged count → propose `/triage` if > 5.
5. Unpushed repos count → propose `pushall` (explicit; never push on your own).

Rules: reports are the record, chat is the summary — don't paste reports back. If a tool is missing (`command -v` fails), skip its file and say so. Don't commit the reports unless told (they're inside each tool repo; `reports/` may be gitignored per repo — respect it).
