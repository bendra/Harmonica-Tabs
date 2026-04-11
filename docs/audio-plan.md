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
