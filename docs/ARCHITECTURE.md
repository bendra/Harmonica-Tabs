# Architecture Snapshot

Date: 2026-03-22  
Status: Rapid exploration (structure and behavior are still changing quickly)

This document describes the app as it exists today. It is intentionally practical: enough context for a typically-skilled React/TypeScript developer to contribute safely without reverse-engineering the whole codebase.

## 1. Scope and Product Shape

- App: `harmonica-tabs` (Expo + React Native + TypeScript, web-first usage today).
- Purpose: show playable harmonica tabs for selected scales/arpeggios on 10-hole Richter diatonic harmonica.
- Current extra capability: live pitch tracking on web (Web Audio), including visual caret placement between neighboring tab chips and tone-follow cursor advancement in the transposer.

Out of scope today:
- Alternate tunings/instrument types.

## 2. Runtime and Entry Points

- Entry: `harmonica-tabs/index.ts` registers `App`.
- Main UI + orchestration: `harmonica-tabs/App.tsx`.
- App is still a manual single-component navigation architecture; most composition happens inside `App.tsx`.

## 3. Module Map

### Data layer (`harmonica-tabs/src/data`)
- `notes.ts`: pitch-class utilities (`noteToPc`, `pcToNote`, `normalizePc`).
- `keys.ts`: harmonica key catalog (`HARMONICA_KEYS`) used by the harmonica selector.
- `scales.ts`: static scale interval definitions.
- `richter.ts`: canonical C Richter layout + transposition helper.

### Logic layer (`harmonica-tabs/src/logic`)
- `tabs.ts`: core mapping from pitch classes to playable tab groups. Includes bend/overbend formatting and ordering.
- `arpeggios.ts`: generates triad/7th/blues arpeggio sections from selected scale root/definition.
- `pitch.ts`: MIDI/frequency/cents conversions + nearest tab matching + interpolation factor `t`.
- `app-storage.ts`: app-owned async string-storage wrapper plus shared SQLite database access used by native persistence.
- `saved-tab-library.ts`: saved-tab repository with backend-aware persistence, native legacy migration, saved-context normalization, sorting, title helpers, and persistence service.
- `transposer.ts`: parses transposer input and produces both render segments and playable output-token metadata.
- `transposer-follow.ts`: pure cursor-advance state machine for tone-follow behavior.
- `web-audio.ts`: web microphone pitch detector (wraps Web Audio API; feeds raw PCM frames to `fft-detector.ts`).
- `fft-detector.ts`: FFT-based YIN pitch detector (`detectSingleNote`) and Goertzel-based chord detector (`detectChord`). Platform-agnostic; used by both web and native paths.
- `native-audio.ts`: native module wrapper with the same `{ isSupported, start, stop }` interface as `web-audio.ts`. The native module sends raw PCM to JS; detection runs in `fft-detector.ts`.

### UI layer
- `App.tsx`: all view state, controls, layout measurement, selection behavior, and rendering.

## 4. State Model (Current)

In `App.tsx`, state is split by concern:
- Top-level navigation: current workspace (`scales` vs `tabs`), properties return target, tabs-local subview (`transpose` vs `library`), and tabs-editor visibility.
- Musical selection: harmonica key, scale root, scale id, overbend notation, arpeggio section selection.
- Pitch listening: start/stop status, detector snapshot (`frequency`, `confidence`, `rms`, `source`, `lastDetectedAt`), hold timer, and debug controls.
- Visual tracking: measured layouts for main tabs and each arpeggio row, plus row-selection state for caret placement.
- Transposer source + follow: selected saved-tab id for the transposer, current octave offset (integer steps of 12 semitones), active output token index, hold/re-arm state, and tone-follow settings.
- Editor state: raw draft text, current selection, linked saved-tab id, tabs-local return target, save-dialog state, dirty-open confirmation state, and new-draft confirmation state.
- Saved-tab library: persisted records, library status text, and pending saved-context open choice.

Derived values (`useMemo`) drive most rendering:
- `groups` from `buildTabsForScale(...)`.
- `selectedTabs` (post-alt-selection projection of groups).
- `arpeggioSections` from `buildArpeggioSections(...)`.
- `pitchMatch` from `matchFrequencyToTabs(...)`.
- `transposerBaseShift` from `resolveTransposerBaseShift(...)`, using the selected saved tab's `inputText` plus the current target.
- `transposerResult` from `transposeTabTextAtShift(...)`, using the current base shift plus octave offset.
- `transposerFollowEvaluation` from `evaluateTransposerFollow(...)`.

## 5. Core Flows

### A) Build tabs for a selected scale
1. User picks harmonica key + scale key/scale type.
2. `buildTabsForScale` gets target pitch classes.
3. `buildTabsForPcSet` scans transposed Richter layout, collects playable candidates (blow/draw/bends/overbends), groups by MIDI, sorts options.
4. UI renders one chip per MIDI slot, with optional `alt` handling if `-2`/`3` dual fingering exists.

### B) Build arpeggio rows
1. User selects Triads, 7th, or Blues section.
2. `buildArpeggioSections` creates harmonic specs (`orderedPcs`, labels, quality).
3. Each arpeggio item reuses `buildTabsForPcSet` to render playable tabs for its pitch set.

### C) Live pitch-to-tab feedback
1. User starts listening.
2. Web: `createWebAudioPitchDetector().start(...)` streams pitch updates. Native: `createNativeAudioPitchDetector().start(...)` does the same via the custom Expo module. Both call `detectSingleNote()` in `fft-detector.ts` and emit a `SingleNoteResult`.
3. App computes closest tab(s) and interpolation `t` via `matchFrequencyToTabs`.
4. Caret is drawn between measured chip centers (or aligned to active row on wrap).
5. In-tune visual threshold uses `±10` cents (`toneToleranceCents`).

### D) Tone-followed transposer output
1. User selects a saved source tab from the library.
2. The transposer resolves one base shift for the current target.
3. The displayed result is that base shift plus the current octave offset in 12-semitone steps.
4. `Down` and `Up` move one more octave from the current display when the next step stays fully playable.
5. `Base` resets the transposer to the saved tab in first position and also resets the target picker to first position on the current harmonica key.
6. User starts shared listening from the transposer page; tone follow is implied while listening is active.
7. `evaluateTransposerFollow(...)` checks the current output token against the shared detector snapshot using tolerance, confidence, and hold-duration settings.
8. Matching tokens advance the cursor; repeated identical notes require a release before the next advance, and the last playable token wraps back to the first.
9. Clicking a playable output token moves the cursor manually, and the transposer output scroll view auto-scrolls minimally when the active token falls outside the visible viewport.

### E) Tabs workspace, saved-tab library, and editor
1. User enters the `Tabs` workspace, which contains sibling `Transpose` and `Library` views plus an editor child screen.
2. `saved-tab-library.ts` persists saved tabs through a backend-aware service: web uses the saved-tab JSON blob in app storage, while native keeps the typed SQLite-backed path and imports legacy JSON-blob records on first read.
3. Each saved tab stores raw `inputText`, title/timestamps, and optional harp+position context (`harmonicaPc`, `positionNumber`).
4. The `Library` view lists saved items sorted by `title` ascending with a stable secondary tie-break.
5. Choosing `Open` on a saved tab sets the transposer source tab and switches `Tabs` to the `Transpose` view.
6. If the saved tab includes harp/position context and it mismatches the current target, the app prompts the user to either use the saved harp+position, keep the current harp but switch to the position that preserves the same target key, or keep the current selection and just load.
7. Choosing `Edit` opens the editor child screen for that saved item; if the current editor has unsaved changes, a confirmation dialog offers `Cancel`, `Open Anyway`, or `Save Then Open`.
8. `Clean Input` on the editor always strips non-tab content and normalizes excess whitespace before saving or further editing.
9. The editor can optionally save the current harp+position context; the toggle defaults off for new drafts, and saving with it off clears any previously stored context on that record.
10. `Save As` branches the current editor text into a new saved record without overwriting the original linked tab.
11. `New` clears the editor into a blank draft; if there are unsaved changes, a confirmation dialog offers `Cancel`, `Discard and New`, or `Save Then New`.
12. Deleting the active saved item removes it from storage; if that item was the current editor link, the editor keeps its text as an unsaved draft, and if it was the transposer source, the transposer falls back to its empty state.

## 6. Storage Strategy

### Abstraction layer

`src/logic/app-storage.ts` defines an `AppStorage` interface (`getItem` / `setItem` / `removeItem`) that the rest of the app depends on. No call site above this layer knows which backend is in use.

### Platform backends

| Platform | File | Backend |
|---|---|---|
| Web | `src/logic/app-storage.web.ts` | Browser `localStorage` |
| Native (iOS/Android via Expo Go) | `src/logic/app-storage.ts` | SQLite via `expo-sqlite` (`harmonica-tabs.db`) |

Expo's platform-specific module resolution picks the right file automatically: the `.web.ts` suffix causes the web build to use `app-storage.web.ts`; native builds fall through to `app-storage.ts`.

The native SQLite implementation uses a simple two-column key-value table (`kv_store`) — no relational schema. SQLite is used here purely for its persistence guarantees on iOS/Android, not for query capabilities.

### Why not SQLite on web too?

`expo-sqlite` does support web via the browser's Origin Private File System (OPFS) API, so it is technically possible. It is not used because:

- The app only stores a single JSON blob per storage key; there are no queries where SQLite would add value over `localStorage`.
- Shipping SQLite on web requires a ~1 MB+ WebAssembly binary, a meaningful load-time cost for no functional gain.
- OPFS has narrower browser support and more complex initialization than `localStorage`.
- The `AppStorage` abstraction already contains the divergence cleanly; the rest of the codebase is unaffected.

If the app ever needs full-text search, relational queries, or a significantly larger data volume, revisiting SQLite on web would be reasonable.

### Tab data layout

Above the platform storage layer, saved tabs share the same record shape: `id`, `title`, `inputText`, optional saved context, and timestamps. On web, the entire library is serialized as one JSON blob under `harmonica-tabs:saved-tabs`. On native, the current service keeps a typed SQLite table and migrates legacy blob data on first read.

There is no sync between platforms — web app storage and native SQLite are independent stores.

## 7. Important Behavioral Rules

- Standard 10-hole Richter only.
- Overbends are excluded on holes `2`, `3`, and `8` (`tabs.ts`).
- Overbend notation is user-selectable (`'` vs `°`).
- Harmonica-key labels and target/scale-note labels have separate flat/sharp display preferences, both defaulting to flats.
- Alternate selection is currently most visible for G (`-2` vs `3`) where both exist at the same MIDI pitch.
- Saved tabs intentionally exclude transposition direction, tone-follow state, and derived output; they may optionally include harmonica key plus target position context for reopen behavior.
- `Save` overwrites the linked saved record when one exists; `Save As` always creates a new saved record.
- The transposer never works from an unsaved draft.
- If mic is unavailable/blocked/unsupported, app runs with simulated frequency input.
- Detector-specific code remains isolated so a future native audio pipeline can feed the same detector snapshot and transposer-follow logic.

## 8. Testing and Quality Gates

- Test runner: Vitest (`npm test` in `harmonica-tabs`).
- Current coverage focus: transposer behavior, editor/library UI interactions, and core tab logic.
- Verified today by tests:
  - known C major output on C harp,
  - `-2` vs `3` alternate behavior,
  - overbend notation rendering,
  - overbend hole exclusions,
  - saved-tab storage persistence/update/sort behavior, including web blob storage and native migration behavior,
  - transposer source selection, token-clicking, and auto-scroll behavior,
  - editor save/re-save/save-as/new-draft/dirty-open flows,
  - saved-context open-prompt behavior and editor toggle defaults/restoration.

Current gap:
- No automated tests yet for `arpeggios.ts` or `pitch.ts`.

## 9. Contributor Playbook (What You Need to Contribute Usefully)

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
- Add or update tests whenever behavior changes.
- Preserve current UX fallbacks (especially simulated Hz) unless intentionally changing product behavior.

## 10. Known Architecture Debt

- `App.tsx` is still large and mixes orchestration + rendering + interaction details.
- Layout-measurement logic is duplicated across main and arpeggio tab rows.
- Pitch detection runs on web (Web Audio API) and native iOS/Android (raw PCM via custom Expo module). Both paths use the same `fft-detector.ts` implementation.
- Some data/logic assumptions are implicit (for example, technique ranking and alternate handling conventions).

## 11. Working Agreement While Exploring

- Treat this document as a snapshot, not a fixed contract.
- Favor clarity and correctness over abstraction.
- If a change introduces a new invariant or replaces a current behavior, update:
  - `docs/STATE.md`
  - `docs/TODO.md`
  - and this architecture snapshot when structure/flow changes materially.
