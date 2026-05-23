# Native Audio: performance fix, test hardening, and open detection bug

## Context

This session shipped a native-audio perf fix (Swift producer-side rate limiting, default `minSendIntervalMs = 50`, plus a JS stale-frame guard and a live-tunable Properties control). Goal: add proportionate regression tests so a future refactor can't silently undo the perf gains.

**Honest constraint up front:** the core fix is in `modules/harmonica-audio/ios/HarmonicaAudioModule.swift`. Vitest cannot test Swift; there is no Swift test target and adding one is a large, separate, ask-first tooling change. So **no test below protects the Swift rate-limiter itself** — only the TS-side glue that would defeat the perf work even with Swift intact. The Swift mechanism stays covered only by the on-device verification step already documented in `docs/ARCHITECTURE.md` flow 5C. This gap should be recorded in `docs/TODO.md`.

The two small extractions below follow an existing codebase convention: pure helpers are already exported from hooks purely for testing (`smoothedFrequency`, `nextResponsiveFrequency` in `use-audio-listening.ts`, tested in `tests/hooks/use-audio-listening-policy.test.ts`).

## Implementation outcome (completed 2026-05-17)

Done and merged-as-described, with two deviations from the plan below — both forced by reality, both consistent with existing conventions:

- **`isStaleFrame` lives in a new module `src/logic/native-audio-policy.ts`, not in `native-audio.ts`.** Confirmed: `native-audio.ts` calls `requireNativeModule` at import time and *cannot be imported under Vitest at all*, so a helper exported from it would still be untestable. The pure helper went into a sibling `*-policy` module (matching the `use-audio-listening-policy` convention); `native-audio.ts` imports it. Test file is `tests/logic/native-audio-policy.test.ts` (not `native-audio.test.ts`). **Future rule: any testable native-path logic goes in `native-audio-policy.ts`.**
- **Added `testID="send-interval-debug-input"`** to the Properties debug field so the wiring test can drive the live-change path through the real App (no store DI, per plan). Consistent with the codebase's existing `testID` usage.

Also fixed in passing: a stale comment in `native-audio.ts` that still claimed `STALE_FRAME_MS` was 200ms/“2× frame duration” when the value is 500 and its role is now just a start/stop-race safety net (Swift rate limiting bounds the queue).

Verification actually performed: `tsc --noEmit` clean; **174 tests pass** (164 prior + 10 new). Both new guards were mutation-checked and confirmed non-vacuous: flipping `>`→`>=` in `isStaleFrame` fails the exclusive-boundary case; disabling the `intervalChanged` branch in `setParams` fails the live-change assertion. `docs/TODO.md` updated with the Swift-coverage-gap entry.

## Changes (as planned)

### 1. Stale-frame guard — extract + test (highest value)
- `src/logic/native-audio.ts`: extract the inline guard into an exported pure fn:
  `export function isStaleFrame(capturedAtMs: number | null, nowMs: number, staleMs: number): boolean` → `capturedAtMs != null && nowMs - capturedAtMs > staleMs`. Call it from the listener (behaviour-preserving). This also makes it testable without importing the un-mockable native module.
- New `tests/logic/native-audio.test.ts`: fresh frame passes, stale frame dropped, exactly-at-threshold passes (`>` not `>=`), `null` capturedAt passes (safety-net behaviour). Guards against a future refactor inverting/removing the comparison.

### 2. minSendIntervalMs clamp — export + test (guards the perf floor)
- `src/hooks/use-audio-settings.ts`: export the existing private `parseBoundedInteger` (pure; no behaviour change).
- New `tests/hooks/use-audio-settings-policy.test.ts` (mirrors the existing `-policy` naming): assert `'25' → 50` (below floor clamps up — directly guards the rate-limit floor that prevents the unbounded queue), `'9999' → 400`, `'' / 'abc' → 50` (fallback), and `DEFAULT_AUDIO_SETTINGS.minSendIntervalMs === 50`. If the floor or default is ever weakened, this fails loudly.

### 3. Live-update wiring — extend existing lifecycle test (no store refactor)
- `tests/ui/listening-lifecycle.test.tsx` (+ its `web-audio` module mock): add a `setMinSendIntervalMs` spy to the mocked detector. Assert it is called (a) on listen start with the current value, and (b) when the `AudioListeningProvider` `minSendIntervalMs` prop changes while listening (the `intervalChanged` branch in `setParams`). Reuses the existing proven module-mock pattern — no dependency injection into `createAudioListeningStore`.

## Explicitly NOT doing (would be test theater / disproportionate)
- Runtime test of `web-audio.ts` no-op `setMinSendIntervalMs`: `tsc` already enforces interface parity (typecheck passes). No added value.
- Adding dependency injection to `createAudioListeningStore` just to unit-test the store: disproportionate architectural change; #3 covers the wiring via the existing pattern.
- Any attempt to unit-test the Swift rate-limiter in Vitest: not possible; documented as a known gap instead.

## Critical files
- `src/logic/native-audio.ts` (extract `isStaleFrame`), new `tests/logic/native-audio.test.ts`
- `src/hooks/use-audio-settings.ts` (export `parseBoundedInteger`), new `tests/hooks/use-audio-settings-policy.test.ts`
- `tests/ui/listening-lifecycle.test.tsx` + its web-audio mock
- `docs/TODO.md`: record the Swift-rate-limiter test-coverage gap (+ optional future Swift test target as ask-first)

## Verification
- `npx tsc --noEmit` clean; `npm test` — all existing 164 pass plus the new cases.
- Sanity-check the new tests actually fail when the guarded behaviour is reverted (e.g. flip `>` to `>=`, drop the `intervalChanged` branch) before finalising.

## Native-only octave/subharmonic misdetection — implemented 2026-05-17

Distinct bug from the bridge-performance issue. On native iOS only, some notes read exactly one octave down (C harp: 6-blow G5→ -2 G4; 8-blow E6→ 5-blow E5 — exact ½-frequency). Web was less affected in live use, but the detector implementation is shared, so the fix belongs in shared TypeScript.

Diagnosis (high confidence): classic YIN subharmonic error. Before this fix, `yinDetect` accepted the *first* CMND dip below `YIN_THRESHOLD = 0.15`, scanning lag upward. A periodic signal dips at period T and at 2T; there was no octave-down sanity check (the FFT-autocorrelation design only guarded the opposite, octave-*up*, error). Native's lower SNR (`.default` AVAudioSession vs the browser's WebRTC noise-suppression/AGC) made the T dip miss 0.15 for weak/high notes, so the scan fell through to the deeper 2T dip → reported f/2. Native-only because the detector code is byte-identical on both paths — only the input signal differs.

Implemented Path A: `yinDetect` now checks the local dip near half of the first accepted lag. If that shorter-lag dip is plausible and only barely missed the normal YIN threshold, the detector prefers it over the octave-low accepted lag. The helper `diagnoseYinOctaveCandidate` exposes the accepted lag, half lag, CMND values, and decision reason for offline diagnosis.

Evidence: existing recorded samples had frames where the first accepted lag produced raw half-frequency values (for example C harp 9 draw F6 reporting F5; G harp 9 draw C6 reporting C5). After the fix, `npm run detect-offline` reports 100% correct / 0% wrong octave / 0% wrong note in the single-note summaries for C, E, and G sample sets, and the new "YIN octave-check corrections" section shows the corrected CMND decisions. Vitest also has recorded-frame regressions plus a low-register guard for G harp 1 blow.

Still verify on-device with native debug output when possible. If a future live failure shows `Raw ≈ true Hz`, that is not this YIN octave-low bug; investigate snapping/smoothing instead. Do **not** pull the C-2 (YIN-in-Swift) lever for this.
