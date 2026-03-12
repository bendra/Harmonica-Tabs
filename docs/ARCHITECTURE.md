# Architecture Snapshot

Date: 2026-03-02  
Status: Rapid exploration (structure and behavior are still changing quickly)

This document describes the app as it exists today. It is intentionally practical: enough context for a typically-skilled React/TypeScript developer to contribute safely without reverse-engineering the whole codebase.

## 1. Scope and Product Shape

- App: `harmonica-tabs` (Expo + React Native + TypeScript, web-first usage today).
- Purpose: show playable harmonica tabs for selected scales/arpeggios on 10-hole Richter diatonic harmonica.
- Current extra capability: live pitch tracking on web (Web Audio), including visual caret placement between neighboring tab chips.

Out of scope today:
- Alternate tunings/instrument types.
- Native mobile microphone pipeline (web implementation exists; non-web falls back to simulated Hz).

## 2. Runtime and Entry Points

- Entry: `harmonica-tabs/index.ts` registers `App`.
- Main UI + orchestration: `harmonica-tabs/App.tsx`.
- App is currently a single-screen architecture; most composition happens inside `App.tsx`.

## 3. Module Map

### Data layer (`harmonica-tabs/src/data`)
- `notes.ts`: pitch-class utilities (`noteToPc`, `pcToNote`, `normalizePc`).
- `keys.ts`: harmonica key catalog (`HARMONICA_KEYS`) and flat/sharp preference.
- `scales.ts`: static scale interval definitions.
- `richter.ts`: canonical C Richter layout + transposition helper.

### Logic layer (`harmonica-tabs/src/logic`)
- `tabs.ts`: core mapping from pitch classes to playable tab groups. Includes bend/overbend formatting and ordering.
- `arpeggios.ts`: generates triad/7th/blues arpeggio sections from selected scale root/definition.
- `pitch.ts`: MIDI/frequency/cents conversions + nearest tab matching + interpolation factor `t`.
- `web-audio.ts`: web microphone pitch detector (autocorrelation-like approach + EMA smoothing).

### UI layer
- `App.tsx`: all view state, controls, layout measurement, selection behavior, and rendering.

## 4. State Model (Current)

In `App.tsx`, state is split by concern:
- Musical selection: harmonica key, scale root, scale id, overbend notation, arpeggio section selection.
- Alternate tab choice: `altSelections` keyed by `rootPc:scaleId:midi`.
- Pitch listening: start/stop status, source (`web`/`sim`), detected frequency/confidence/rms, hold timer, debug controls.
- Visual tracking: measured layouts for main tabs and each arpeggio row, selection checkboxes controlling which row receives caret.

Derived values (`useMemo`) drive most rendering:
- `groups` from `buildTabsForScale(...)`.
- `selectedTabs` (post-alt-selection projection of groups).
- `arpeggioSections` from `buildArpeggioSections(...)`.
- `pitchMatch` from `matchFrequencyToTabs(...)`.

## 5. Core Flows

### A) Build tabs for a selected scale
1. User picks harmonica key + scale key/scale type.
2. `buildTabsForScale` gets target pitch classes.
3. `buildTabsForPcSet` scans transposed Richter layout, collects playable candidates (blow/draw/bends/overbends), groups by MIDI, sorts options.
4. UI renders one chip per MIDI slot, with optional `alt` overlay if `-2`/`3` dual fingering exists.

### B) Build arpeggio rows
1. User selects Triads, 7th, or Blues section.
2. `buildArpeggioSections` creates harmonic specs (`orderedPcs`, labels, quality).
3. Each arpeggio item reuses `buildTabsForPcSet` to render playable tabs for its pitch set.

### C) Live pitch-to-tab feedback
1. User starts listening.
2. Web: `createWebAudioPitchDetector().start(...)` streams pitch updates.
3. App computes closest tab(s) and interpolation `t` via `matchFrequencyToTabs`.
4. Caret is drawn between measured chip centers (or aligned to active row on wrap).
5. In-tune visual threshold uses `±10` cents (`toneToleranceCents`).

## 6. Important Behavioral Rules

- Standard 10-hole Richter only.
- Overbends are excluded on holes `2`, `3`, and `8` (`tabs.ts`).
- Overbend notation is user-selectable (`'` vs `°`).
- Enharmonic spelling follows harmonica key flat/sharp preference.
- Alternate selection is currently most visible for G (`-2` vs `3`) where both exist at same MIDI pitch.
- If mic is unavailable/blocked/unsupported, app runs with simulated frequency input.

## 7. Testing and Quality Gates

- Test runner: Vitest (`npm test` in `harmonica-tabs`).
- Current coverage focus: `src/logic/tabs.test.ts`.
- Verified today by tests:
  - known C major output on C harp,
  - `-2` vs `3` alternate behavior,
  - overbend notation rendering,
  - overbend hole exclusions.

Current gap:
- No automated tests yet for `arpeggios.ts`, `pitch.ts`, or web audio detector behavior.

## 8. Contributor Playbook (What You Need to Contribute Usefully)

### Local workflow
1. `cd harmonica-tabs`
2. `npm install`
3. `npm run web` (fastest feedback loop)
4. `npm test` before opening PRs

### Where to implement changes
- Music theory data change: `src/data/*.ts`.
- Tab generation behavior: `src/logic/tabs.ts` (+ update/add tests).
- Pitch matching/caret behavior: `src/logic/pitch.ts` and `App.tsx` measurement/render code.
- Arpeggio content/rules: `src/logic/arpeggios.ts`.
- UI wording/layout/styles: mostly `App.tsx`.

### Safe change strategy
- Keep edits incremental; this codebase is in exploration mode.
- Prefer adding/adjusting pure logic first, then wire UI.
- Add or update tests whenever `tabs.ts` behavior changes.
- Preserve current UX fallbacks (especially simulated Hz) unless intentionally changing product behavior.

### High-value near-term contributions
- Add tests for `arpeggios.ts` and `pitch.ts`.
- Extract some `App.tsx` sections into small components/hooks without changing behavior.
- Improve state-keying for alternates so arpeggio/main-tab selection is explicit and less coupled.
- Improve mobile layout/row wrapping ergonomics with minimal visual churn.

## 9. Known Architecture Debt

- `App.tsx` is large and mixes orchestration + rendering + interaction details.
- Layout-measurement logic is duplicated across main and arpeggio tab rows.
- Pitch detection is web-only and intentionally lightweight (accuracy/stability tradeoffs).
- Some data/logic assumptions are implicit (for example, technique ranking and alternate handling conventions).

## 10. Working Agreement While Exploring

- Treat this document as a snapshot, not a fixed contract.
- Favor clarity and correctness over abstraction.
- If a change introduces a new invariant or replaces a current behavior, update:
  - `docs/STATE.md`
  - `docs/TODO.md`
  - and this architecture snapshot when structure/flow changes materially.
