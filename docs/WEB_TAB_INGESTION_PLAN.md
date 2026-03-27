# Intelligent Web Tab Ingestion Plan (Draft)

## Summary
Build a backend-first ingestion pipeline that searches only approved domains, extracts candidate tabs with per-site parsers, normalizes to the app's transposer token format, and returns only high-confidence imports.

Chosen defaults:
- Allowlist-only sources
- Server-side + cache
- High-precision acceptance

## Key Implementation Changes

1. Add a small ingestion service (server-side)
- Endpoints:
  - `POST /tab-search` with `{ query, instrument: "diatonic-10", sourceDomains? }`
  - `POST /tab-extract` with `{ sourceUrl }`
- Return:
  - `candidates[]` (title, artist, sourceUrl, sourceSite, snippet, confidence, parseStats)
  - `normalizedTab` (canonical tab text ready for transposer)
  - `warnings[]` (unsupported symbols, partial parse, source issues)

2. Use connector architecture per source
- `SearchConnector`: domain-scoped search constrained to allowlist.
- `ExtractConnector`: per-site parser with stable selectors/patterns.
- Initial connectors:
  - `harptabs.com`
  - `learntheharmonica.com`
- Optional generic fallback parser only for allowlisted domains.

3. Add normalizer + validator layer
- Map source notation variants to canonical token grammar.
- Validate with existing parser/transposer logic:
  - `src/logic/transposer.ts`
  - `src/logic/transposer-input.ts`
- Confidence gate based on parse success and noise levels.

4. Add cost/abuse controls
- Cache by normalized query + source URL.
- Per-user/API-key rate limits.
- Free tier: cached results + strict daily cap.
- Paid tier: live fetch + higher caps.
- Monitor connector health and disable failing connectors quickly.

5. Add policy/compliance guardrails
- Respect robots/terms with per-domain policy (`allowed`, `blocked`, `manual-review`).
- Store structured extracted tokens, not full page mirrors.
- Always include source attribution URL and site.

## Test Plan

1. Connector tests
- Parse saved HTML fixtures from HarpTabs/LearnTheHarmonica into raw tab candidates.

2. Normalization tests
- Convert common variants (`+4`, `4+`, apostrophes, degree symbol, spacing/punctuation noise) into canonical tokens.

3. Validation/confidence tests
- Accept clean tab pages.
- Reject lyric-heavy/noisy pages.
- Verify confidence/warning thresholds.

4. End-to-end API tests
- Query -> candidate -> extract -> normalized tab output is transposer-ready.

## Assumptions
- Initial scope: 10-hole diatonic, mostly first-position content.
- No UI changes in this phase.
- Connector breakages are isolated and hotfixable without changing transposer logic.
- Unclear legal/policy domain status defaults to `manual-review`.
