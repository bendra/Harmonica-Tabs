# Architecture Snapshot

Date: 2026-03-17  
Status: Rapid exploration (structure and behavior are still changing quickly)

This document describes the app as it exists today. It is intentionally practical: enough context for a typically-skilled React/TypeScript developer to contribute safely without reverse-engineering the whole codebase.

## 1. Scope and Product Shape

- App: `harmonica-tabs` (Expo + React Native + TypeScript, web-first usage today).
- Purpose: show playable harmonica tabs for selected scales/arpeggios on 10-hole Richter diatonic harmonica.
- Current extra capability: live pitch tracking on web (Web Audio), including visual caret placement between neighboring tab chips and tone-follow cursor advancement in the transposer.

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
- `app-storage.ts`: app-owned async string-storage wrapper around device persistence.
- `saved-tab-library.ts`: versioned saved-tab parsing, sorting, title helpers, and persistence service.
- `transposer.ts`: parses transposer input and produces both render segments and playable output-token metadata.
- `transposer-follow.ts`: pure cursor-advance state machine for tone-follow behavior.
- `web-audio.ts`: web microphone pitch detector (autocorrelation-like approach + EMA smoothing).

### UI layer
- `App.tsx`: all view state, controls, layout measurement, selection behavior, and rendering.

## 4. State Model (Current)

In `App.tsx`, state is split by concern:
- Musical selection: harmonica key, scale root, scale id, overbend notation, arpeggio section selection.
- Alternate tab choice: `altSelections` keyed by `rootPc:scaleId:midi`.
- Pitch listening: start/stop status, detector snapshot (`frequency`, `confidence`, `rms`, `source`, `lastDetectedAt`), hold timer, debug controls.
- Visual tracking: measured layouts for main tabs and each arpeggio row, selection checkboxes controlling which row receives caret.
- Transposer follow: tone-follow enabled state, active output token index, hold/re-arm state, and tone-follow settings.
- Saved-tab library: persisted records, currently loaded saved-tab id, explicit save mode (`overwrite`, `create_new`, `save_then_load`, `save_then_new`), save-dialog title/edit state, pending load confirmation state, and new-draft confirmation state.

Derived values (`useMemo`) drive most rendering:
- `groups` from `buildTabsForScale(...)`.
- `selectedTabs` (post-alt-selection projection of groups).
- `arpeggioSections` from `buildArpeggioSections(...)`.
- `pitchMatch` from `matchFrequencyToTabs(...)`.
- `transposerResult` from `transposeTabText(...)`, including playable output tokens.
- `transposerFollowEvaluation` from `evaluateTransposerFollow(...)`.

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

### D) Tone-followed transposer output
1. User enters/pastes tabs and the transposer produces render segments plus playable output tokens.
2. If the selected target is first position (same key as the harmonica), the transposer treats that as an octave move instead of a no-op. `Down` attempts one octave down, and `Up` attempts one octave up.
3. The screen still auto-picks a default first-position direction by playability: prefer down when it keeps the whole passage playable, otherwise prefer up, otherwise default back to down and leave invalid notes flagged inline.
4. User starts shared listening from the transposer page; tone follow is implied while listening is active.
5. `evaluateTransposerFollow(...)` checks the current output token against the shared detector snapshot using tolerance, confidence, and hold-duration settings.
6. Matching tokens advance the cursor; repeated identical notes require a release before the next advance, and the last playable token wraps back to the first.
7. Clicking a playable output token moves the cursor manually, and any transposer-output change resets the cursor to the first playable token.
8. The transposer output scroll view measures token positions and auto-scrolls minimally when the active token falls outside the visible viewport.

### E) Saved-tab library
1. User saves the current transposer input with a title.
2. `saved-tab-library.ts` persists only the raw `inputText` plus library metadata (`id`, `title`, timestamps) under one versioned storage key.
3. Opening the Library screen lists saved items sorted by `updatedAt` descending.
4. Loading a saved tab replaces only `transposerInput`; other musical/transposition settings stay untouched.
5. If the current editor has unsaved changes, a confirmation dialog offers `Cancel`, `Load Anyway`, or `Save Then Load`.
6. `Save As` branches the current editor text into a new saved record without overwriting the original loaded tab.
7. `New` clears the editor into a blank draft; if there are unsaved changes, a confirmation dialog offers `Cancel`, `Discard and New`, or `Save Then New`.
8. Deleting the active saved item removes it from storage but leaves the current editor text in place as an unsaved draft.

## 6. Important Behavioral Rules

- Standard 10-hole Richter only.
- Overbends are excluded on holes `2`, `3`, and `8` (`tabs.ts`).
- Overbend notation is user-selectable (`'` vs `°`).
- Enharmonic spelling follows harmonica key flat/sharp preference.
- Alternate selection is currently most visible for G (`-2` vs `3`) where both exist at same MIDI pitch.
- Saved tabs intentionally exclude harmonica key, position/key, transposition direction, tone-follow state, and derived output.
- `Save` overwrites the linked saved record when one exists; `Save As` always creates a new saved record.
- If mic is unavailable/blocked/unsupported, app runs with simulated frequency input.
- Detector-specific code remains isolated so a future native audio pipeline can feed the same detector snapshot and transposer-follow logic.

## 7. Testing and Quality Gates

- Test runner: Vitest (`npm test` in `harmonica-tabs`).
- Current coverage focus: transposer behavior and UI interactions, plus core tab logic.
- Verified today by tests:
  - known C major output on C harp,
  - `-2` vs `3` alternate behavior,
  - overbend notation rendering,
  - overbend hole exclusions,
  - saved-tab persistence/update/sort behavior,
  - transposer save/load/re-save/save-as/new-draft/delete flows and dirty-state confirmations.

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
