---
name: sanitize
description: "Reviews text before it is written to any CatPilot file and flags or redacts sensitive or employer-internal details. Use before saving tasks, journal entries, memos, milestones, learning notes, or growth/review-prep content, and whenever the user pastes content that may contain confidential information."
license: MIT
---

# Skill: sanitize

## Mission
Keep CatPilot **publishable and employer-safe**. The public repo and any synced
storage must never contain secrets or confidential, employer-internal details.
This skill is a pre-write guardrail: it inspects content, flags risks, proposes a
neutral rewrite, and only then lets the write proceed.

## When to use
Run this skill (or apply its checklist inline) whenever:
- A write is about to happen via `task-management`, `journal-entry`, `memo-creation`,
  `milestone-tracking`, `learning`, or `growth`.
- The user pastes a block of text ("save this", "log this", "turn this into a memo").
- The user asks to prepare review/promotion material ("brag doc", "impact summary").
- The user explicitly asks to "sanitize", "redact", "make this generic/public-safe".

## What to flag (redaction checklist)
1. **Secrets**: tokens, passwords, API keys, connection strings, private URLs, certificates.
2. **Customer / partner identity**: company names, deal sizes, account IDs, contact names.
3. **Internal project codenames** and unreleased product names.
4. **Confidential metrics**: revenue, headcount, internal KPIs, incident/security details.
5. **People data**: performance feedback about named individuals, HR/comp details.
6. **Internal process vocabulary**: names of internal tools, review systems, or programs
   (keep these in the private vault only — never in the public repo or shared exports).
7. **Paths** that reveal private/internal locations when content is meant to be shared.

## Procedure
1. Scan the candidate text against the checklist above.
2. Classify each finding as **block** (secrets — never store anywhere) or
   **redact** (internal details — fine in the private vault, must be neutralized
   for anything public/shared).
3. Produce a **neutral rewrite** that preserves meaning using generic placeholders:
   - Customer name -> `a strategic customer` / `[CUSTOMER]`
   - Codename -> `an internal project` / `[PROJECT]`
   - Metric -> `a significant improvement` / `[METRIC]`
4. Show the user a short diff: what was flagged and the suggested neutral version.
5. Respect the destination:
   - **Private vault** (Layer 2, outside the repo): redaction optional; still block secrets.
   - **Public repo or shared export**: redaction mandatory.
6. Only after confirmation, hand the cleaned text back to the originating skill to write.

## Output format
```
🔒 Sanitization review
- ❌ Blocked: <secret type> (will NOT be stored)
- ⚠️ Redacted: "<original>" -> "<neutral>"
- ✅ Safe to write to: <resolved path>
```

## Rules
1. **Never** write a detected secret to any file, public or private.
2. Default to caution: when unsure whether something is internal, propose redaction.
3. Do not alter the user's meaning — only neutralize identifying/confidential specifics.
4. Keep the mapping of placeholders consistent within a single document.

## Response style
- Use `🔒` to open a review, `⚠️` for redactions, `❌` for blocked secrets, `✅` when cleared.
- Be concise: list only what changed, then confirm the write target.

## Files
- `data/config.json` (to resolve the destination and detect public vs private targets)
- The originating skill's resolved file (written only after sanitization passes)
