---
name: ai-readiness-audit
description: >-
  Audit of how well AI systems can know and serve a Web3 project — two halves: (1) the project's
  own chatbot/copilot (does its knowledge base cover the canonical facts, is it fresh, is its
  retrieval chain trustworthy, can it answer correctly), and (2) the project's AI/discovery
  anchors for EXTERNAL models and search engines (llms.txt, ai.txt, robots.txt, sitemaps,
  JSON-LD, meta/og/canonical tags, .well-known manifests). Use this skill whenever the user asks
  whether a chatbot "has all the info to answer correctly", whether it is "fully trained"
  (vollumfänglich trainiert), whether the site is AI-/LLM-friendly, whether "AI anchors" are in
  place, or whether search engines and external AI can discover the project correctly. German
  triggers: "hat der Chatbot alle Infos", "KI-Anker prüfen", "AI readiness", "llms.txt Audit".
  Complements `web-content-coherence-audit` (what pages SAY) and `web3-integration-audit` (what
  apps DO): this one proves what AI systems can KNOW. For the IFR project pair with the
  inventory from `collateral-web3-audit`.
compatibility: "Claude Code (~/.claude/skills/), Kimi Code, Cowork"
---

# AI Readiness Audit — can AI systems know this project?

Two different failure modes: a copilot that answers from a **stale or incomplete knowledge
base** (confidently wrong), and a project whose **discovery anchors** are missing or
contradictory (invisible or misrepresented to external AI and search engines). Every claim in
the report must be backed by the knowledge file's actual content, a fetched anchor file, or a
quoted tag — never by "the setup looks standard".

## Evidence rules

1. **Knowledge completeness is measured against the canonical fact set**, not vibes. Build the
   fact list from the chain-verified references (contract map, claims register, prior audit
   reports), then check the knowledge base topic by topic: present? correct? current? A fact
   the bot cannot know is a coverage gap; a fact it knows wrong is a correctness finding;
   staleness gets its drift direction labeled.
2. **The retrieval chain is part of the knowledge base.** If the bot fetches live pages at
   runtime, those pages' defects (see content-coherence audit) flow into answers — trace the
   fetch: source, freshness (cache TTL), sanitization, size budget, failure behavior.
3. **Anchors are checked by fetching them**, per host: robots.txt, sitemap.xml (+ referenced
   child sitemaps), llms.txt / llms-full.txt, ai.txt, .well-known/ai-plugin.json, humans.txt.
   For every page class: JSON-LD blocks (validate types/fields against schema.org), meta
   description/og:/twitter, canonical link (must point at the page itself, not a sibling).
4. **Anchor content must match the canonical facts too.** A llms.txt with wrong addresses or a
   JSON-LD with stale counts is a defect, not a bonus.
5. **Boundaries:** anonymous-browser GET/HEAD only. No POSTs to live chat endpoints (static
   analysis of the knowledge path instead); no authenticated calls; report-only.

## Method

### Phase A — Copilot knowledge audit (the project's own AI)

1. Map the knowledge path: static knowledge file(s), system prompts, runtime retrieval (wiki
   fetch? RAG? embeddings?), model + parameters, context budget, cache/freshness.
2. Diff the knowledge base against the canonical fact set: token economics, contract addresses,
   fees, tiers, governance state, vault mechanics, roadmap status, security posture. Note
   coverage gaps, contradictions with chain/code, stale numbers.
3. Safety rails: what the bot refuses (seed phrases, financial advice) and whether refusal is
   implemented in code or only in prompt text (prompt-only is weaker — cite prior findings).
4. Known-bug impact: any registered finding that flows into answers (e.g. shifted ABI decodes,
   stale tier tables) — name the answer classes affected.
5. If a local run is possible without secrets, run it; otherwise state the static-only
   limitation clearly.

### Phase B — External AI / search anchors

Per host (apex, subdomains, API hosts):
- robots.txt: rules sane? sitemap referenced? AI-crawler rules (GPTBot, ClaudeBot, …) present
  or absent — both are a policy statement worth reporting.
- sitemap.xml: exists? complete (all content pages listed)? lastmod sane? URLs match canonical
  scheme/host?
- llms.txt / llms-full.txt / ai.txt: exists? content accurate against canonical facts? links
  resolve? covers the docs corpus?
- Per-page: JSON-LD present and valid (@type usage, required fields), meta description
  present/unique, og:/twitter: cards, canonical self-reference. Flag pages missing the set.
- Consistency: do anchors and pages agree (counts, addresses, status)?

### Phase C — Verdicts

Per area: READY / READY w/ gaps / NOT READY + the smallest fix set. Distinguish "invisible to
AI" (missing anchors) from "misrepresented to AI" (wrong anchor content) — the second is worse.

## Output format

```markdown
# <Project> — AI Readiness Audit
> Scope: <copilot + hosts> · Commit: <sha> · Live checks: <date> · Result: READY / GAPS / NOT READY

## 1. Executive summary
## 2. Copilot knowledge path (map: sources, retrieval, model, freshness)
## 3. Knowledge completeness matrix (fact area → present/correct/current)
## 4. External anchor inventory (per host: robots/sitemap/llms/JSON-LD/meta)
## 5. Findings (severity · file:line or URL · quote/evidence · fix direction)
## 6. Verified strengths
## 7. Limitations (no live chat POSTs, etc.)
```

Severity: Critical/High = the bot gives dangerously wrong financial/contract guidance from
authoritative-looking copy, or anchors actively misdirect (wrong contract address in llms.txt).
Medium = coverage gaps on core topics, stale authoritative numbers in knowledge/anchors, broken
or self-contradictory anchor files. Low = missing nice-to-have anchors, freshness labels,
prompt-only refusals. Info = policy choices (crawler opt-outs), unverifiable model claims.

## Boundaries

Read-only on the live surfaces; local execution only without secrets. Never inject prompts at
the live bot to "test" it — that is load on someone else's inference budget and belongs to an
authorized test plan. Report-only: propose content, don't edit the audited project.
