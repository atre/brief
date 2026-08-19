---
name: triage
description: Triage the fleet's FEEDBACK.md files — turn untriaged sections into PLAN items, lessons, or drops, then mark them triaged. TRIGGER on "triage", "go through feedback", "what's piling up in FEEDBACK", weekly reviews, or when `brief` shows "N untriaged feedback" for a tool you're about to touch.
---

# /triage [tool]

```sh
brief feedback                 # every untriaged FEEDBACK section, one preview line each (all repos, or --only <tool>)
```

For each listed section (open the FEEDBACK.md at the exact `## <date> …` header — read that section only):
1. Classify every bullet:
   - **plan** → append to that tool's `PLAN.md` in the right phase, in the plan's item shape: `- [ ] **<title>** — what / why / → files: … · accept: …`. If an equivalent item exists, add the field evidence to it instead of duplicating.
   - **lesson** (general engineering, not tool-specific) → append to `~/git/hub/LESSONS.md` under today's date: `- lesson (<repo>): <one line> — <why>`; if the FEEDBACK line lacks the `- lesson:` prefix, add it there too.
   - **done** (already shipped per code/CHANGELOG) or **drop** (won't do) → note it in the triage section (step 2), no other action.
2. Append to that FEEDBACK.md: `## <today ISO> — triage` with one line per handled section: `- <section header> → plan: <n> · lesson: <n> · done: <n> · drop: <n>`. This marker is what makes `brief feedback` drop those sections.
3. Same idea in ≥ 3 tools' PLANs → it's cross-tool: move it to `~/git/hub/TOOLS.md` backlog and reference it from the tools' PLANs.
4. Finish with a 5-line summary: items → plans, lessons added, drops. Don't commit unless told.
