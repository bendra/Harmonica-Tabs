# Plan: Native Audio Support for Harmonica Tabs

## Context

The app has a working web audio pitch detector (`src/logic/web-audio.ts`) using autocorrelation via Web Audio API. On native iOS/Android it falls back to simulated frequency input. The architecture is already designed for extension: `DetectorSnapshot` is the shared contract, and all tone-follow, pitch matching, and UI code only sees that interface.

The goals for native audio go beyond just porting the web implementation:
- **Better real-time performance** for tone-follow on the Tabs view
- **Chord detection** on the Scales view — detecting which notes are being played simultaneously

The key insight enabling chord detection: we know the exact frequency of every note on the current harmonica. This turns a hard general problem ("find all pitches in this audio") into a tractable lookup problem ("for each known frequency, is there significant energy there?").

---

## Detection Modes

Two distinct modes with different algorithms and vocabularies:

### Single-note mode (Tabs view)
- FFT-based or autocorrelation
- Full note vocabulary: blow, draw, and bent notes
- Per-note confidence thresholds: require higher confidence for bent/overbent notes (harder to play, weaker signal, more likely to be harmonic bleed from adjacent notes)
- Drives the existing tone-follow cursor

### Chord mode (Scales view)
- FFT only
- Restricted vocabulary: **natural blow/draw notes only** — bends are physically incompatible with multi-hole playing, so exclude them entirely
- Threshold tuned for simultaneous weaker signals
- Reports a *set* of active notes rather than a single frequency
- Modes can be developed and tuned independently

---

## Architecture

### Algorithm: FFT-based frequency-domain detection

Replace autocorrelation with FFT throughout. For each detection frame:
1. Take FFT of the audio buffer (4096 samples → ~10 Hz resolution at 44100 Hz)
2. For each note in the harmonica's vocabulary, sum energy at its fundamental + weighted harmonics
3. Apply per-note threshold (higher for bent notes, lower for natural notes in chord mode)
4. Single-note: return the highest-energy note above threshold with confidence score
5. Chord mode: return all notes above threshold as a set

**Why FFT over autocorrelation?**
- Autocorrelation finds one fundamental; FFT finds energy at arbitrary frequency bins
- FFT enables chord detection; autocorrelation cannot
- 4096-sample FFT gives ~10 Hz resolution — enough to separate adjacent harmonica notes (~20-30 Hz apart in middle octave)
- Still fast enough to run in JS if needed, but native is preferred

**Harmonic interference handling:**
- A low note's 2nd harmonic can fall near a higher note's fundamental
- Mitigate by checking harmonic series: if note N is strong, down-weight nearby frequencies that could be its harmonics when evaluating higher notes
- Bent notes excluded from chord mode eliminates the hardest interference cases

### Native module approach

Build a custom Expo native module (new territory, but the right tool):
- **iOS**: AVAudioEngine with an audio tap — gives real PCM buffers with low latency, no `getUserMedia` overhead
- **Android**: AudioRecord API — direct PCM capture
- The module captures PCM and either:
  - **Option A**: Passes raw PCM buffers to JS via the bridge (JS does FFT + note matching)
  - **Option B**: Does FFT natively and passes back a compact result (energy per known frequency)

Option A is simpler to build and iterate on (pitch detection logic stays in JS where it's easy to change). Option B is faster. Recommend starting with Option A and moving to Option B if JS-side FFT proves too slow.

### JS-side FFT
Use a pure-JS FFT library (e.g. `fft.js` or `kissfft` via WASM). The note-matching logic lives in JS and has access to the harmonica layout data already in `src/logic/tabs.ts` and `src/logic/pitch.ts`.

---

## Key Files

### Existing (to understand/modify)
- `src/logic/web-audio.ts` — current autocorrelation detector; `detectPitch` and `calculateRms` to be superseded or extracted
- `src/hooks/use-audio-listening.ts` — creates detector, manages lifecycle; needs platform-conditional detector selection
- `src/logic/pitch.ts` — frequency↔MIDI↔cents conversions; reuse for note matching
- `src/logic/tabs.ts` / `src/logic/transposer.ts` — harmonica layout data; source of truth for note vocabulary per key
- `src/logic/transposer-follow.ts` — consumes `DetectorSnapshot`; single-note mode unchanged

### New files to create
- `src/logic/harmonica-frequencies.ts` — builds the per-key note vocabulary (frequency, bend status, per-note threshold) from existing tab/pitch logic. Single source of truth for both detection modes.
- `src/logic/fft-detector.ts` — FFT-based note matching for both modes; pure JS, platform-agnostic
- `src/logic/native-audio.ts` — native module wrapper; same `{ isSupported, start, stop }` interface as `web-audio.ts`
- `modules/harmonica-audio/` — the custom Expo native module (iOS Swift + Android Kotlin)

### Interface changes
- `DetectorSnapshot` needs a `notes` field (set of active notes) alongside `frequency` for chord mode
- `useAudioListening` needs a `mode` parameter: `'single' | 'chord'`

---

## Implementation Sequence (incremental)

1. **Extract harmonica frequency vocabulary** (`harmonica-frequencies.ts`) from existing tab/pitch logic — no native code, testable immediately
2. **Build FFT detector in JS** (`fft-detector.ts`) — test against web audio pipeline first (replace autocorrelation on web)
3. **Upgrade web audio** to use the new FFT detector — validates algorithm before touching native
4. **Build the native Expo module** — iOS first (AVAudioEngine), then Android
5. **Wire up native detector** in `useAudioListening` via platform detection
6. **Add chord mode** to the Scales view — new UI to display active note set

This sequence means steps 1–3 are pure JS/web work and can be done and tested in the browser before writing any Swift or Kotlin.

---

## Open Questions

- What FFT library to use: `fft.js` (pure JS, small) vs. WASM-based (faster but more complex setup)?
- Does `DetectorSnapshot` extension for chord mode need to be backward-compatible (keep `frequency: number | null` alongside `notes: Set<NoteId>`) or can we revise the interface?
- Which Scales UI pattern for chord display — highlight multiple scale chips simultaneously?

---

## Verification

- Existing tests in `tests/logic/transposer-follow.test.ts` continue to pass throughout
- Step 2: unit test FFT detector against known audio samples (synthesized sine waves at known harmonica note frequencies)
- Step 3: web tone-follow behavior unchanged after algorithm swap
- Step 5: on physical iOS device, Listen button drives tone-follow with noticeably lower latency than web version
- Step 6: on Scales view, blowing/drawing multiple holes simultaneously highlights the correct set of scale chips

---

## Status: Implemented — and revised based on testing (2026-04-12)

Steps 1–5 above were completed. The result: `harmonica-frequencies.ts`, `fft-detector.ts`, `native-audio.ts`, and the native iOS/Android modules all exist and work. The Goertzel algorithm (an efficient single-bin DFT, equivalent to "FFT for one frequency at a time") was chosen for both modes and is implemented consistently in TypeScript, Swift, and Kotlin.

Testing across C, G, and E harmonicas revealed two failure modes that need to be addressed before this can be considered production-ready. The issues and proposed fixes are described below.

---

## Known Issues and Proposed Fixes

### Issue 1: Octave errors (G harmonica, systematic — worst on native)

**What happens**: On the G harmonica, every note from hole 4 upward is detected as the same pitch class one octave too low. Hole 4 blow (G5 = 784 Hz) registers as hole 1 blow (G4 = 392 Hz), hole 5 blow (B5) registers as hole 2 blow (B4), and so on. The shift is exact and consistent.

**Why**: The original plan chose Goertzel/FFT over autocorrelation partly because "autocorrelation finds one fundamental." That reasoning is correct for chord detection. But for single-note detection it has a blind spot: Goertzel scores each known frequency independently and picks the winner. It does not understand that G4 and G5 are related. Real harmonica reeds — especially at higher frequencies — can vibrate not just at their fundamental but also at a sub-harmonic (half the frequency). When a G5 reed produces some energy at G4, the Goertzel filter at G4 can outscore G5 and win. The algorithm is not broken; it is being given a harder signal than the original design assumed.

Note: the harmonic interference handling described in "Architecture" above was never implemented. The code comment in `fft-detector.ts` actually explains why harmonics were deliberately removed — to prevent a *different* octave error (harmonic energy from a lower note boosting a higher note's score). The sub-harmonic problem is the mirror image of that, and Goertzel has no way to resolve it.

**Fix: replace Goertzel with YIN for single-note detection.**

The YIN algorithm (used by the aubio library and every serious open-source tuner, including [qiuxiang/tuner](https://github.com/qiuxiang/tuner)) works in the time domain rather than the frequency domain. It finds the shortest repeating period in the waveform — which is always the true fundamental, not a sub-harmonic. Its key step, the cumulative mean normalized difference (CMND), specifically suppresses sub-octave false peaks. It can be implemented in ~80 lines and ported to Swift and Kotlin.

The architecture after this change:
```
audio frame
  → YIN → fundamental frequency (e.g. 784 Hz)
  → find nearest note in vocabulary (e.g. G5 = hole 4 blow)
  → confidence = how close the YIN frequency is to that note (in cents)
  → apply per-note threshold
  → emit result
```

This change affects `detectSingleNote()` only. `detectChord()` stays on Goertzel — Goertzel is genuinely the right tool for chord detection (it can score multiple frequencies simultaneously), and YIN is a single-pitch estimator.

### Issue 2: "Flitting" between notes (C harmonica hole 1, G harmonica lower holes)

**What happens**: Hole 1 on C oscillates between holes 1 and 4 (C4 and C5) frame-by-frame. Some lower G harmonica holes flicker between neighbors.

**Why**: Each frame is detected independently. When the signal is at a borderline confidence level, adjacent frames can pick different winners. The existing `AUDIO_SIGNAL_HOLD_MS = 400` holds the *last accepted* detection visible on screen, but does not stabilize detection itself.

**Fix: add temporal smoothing upstream of the UI.** Maintain a short ring buffer (e.g. 5 frames) and only commit to a note when it appears in at least 3 of the last 5 frames. This adds ~50 ms of latency at typical frame rates, which is imperceptible for music practice.

### Issue 3: E harmonica hole 10 blow never registers

**What happens**: The highest note on an E harmonica (E6 ≈ 1319 Hz) is never detected on any platform.

**Why**: Likely a combination of microphone sensitivity at the upper edge of its response curve, and the confidence voting becoming less reliable when fewer notes compete in that frequency range. This should be re-evaluated after the YIN change is in place, since YIN handles high frequencies differently than Goertzel voting.

---

## Revised Implementation Plan

### Phase 1: Temporal smoothing (small, safe, independent of algorithm change)

- **File**: `src/hooks/use-audio-listening.ts`
- Add a ring buffer of the last 5 detected MIDI values; only emit when the same MIDI appears ≥ 3 times.
- No change to the detector itself. No native code changes.

### Phase 2: Replace Goertzel with YIN for single-note detection

- **`src/logic/fft-detector.ts`**: add `yinDetect(input, sampleRate, minFreq, maxFreq)` returning the fundamental Hz or null. Rewrite `detectSingleNote()` to call YIN first, then find the nearest vocabulary note.
- **`modules/harmonica-audio/ios/HarmonicaAudioModule.swift`**: port YIN to Swift, replacing the Goertzel scoring loop in `detectNote()`.
- **`modules/harmonica-audio/android/.../HarmonicaAudioModule.kt`**: same port to Kotlin.

### Phase 3: Re-evaluate Issue 3

After Phase 2, retest E harmonica hole 10 blow. If still failing, investigate per-note threshold or microphone floor adjustments.
