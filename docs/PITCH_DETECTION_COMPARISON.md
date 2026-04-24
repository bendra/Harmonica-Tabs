# Pitch Detection Comparison: `tuner` vs `harmonica-tabs`

## Goal

This note compares the open-source app in `tuner/` with the current pitch-detection path in
`harmonica-tabs/`, with special attention to why `tuner` can feel more reliable for note
detection on a harmonica.

This is source-based analysis only. No production code was changed.

## Short Version

`tuner` uses aubio's pitch detector and maps the returned frequency onto chromatic notes. Its
pipeline is simple and mostly general-purpose.

`harmonica-tabs` uses a custom FFT-based YIN detector, then snaps the result into a
harmonica-specific vocabulary, then applies confidence gating and a signal hold before the
result drives UI behavior.

Both apps now use the same underlying algorithm family (FFT-based autocorrelation YIN, called
`yinfft` in aubio). The performance gap is therefore less about the core algorithm and more
about the layers around it.

## How `tuner` Works

The pitch path in `tuner` is compact:

1. Opens the microphone with `getUserMedia`.
2. Creates a `ScriptProcessor` with a 4096-sample buffer.
3. For each audio callback, passes the raw channel buffer to
   `aubio.Pitch("default", 4096, 1, sampleRate)`.
4. Converts the returned frequency to a chromatic MIDI note and cents offset.
5. Updates the UI only after the **same note name** appears twice in a row.

Relevant files:

- `tuner/app/tuner.js`
- `tuner/app/app.js`

Important characteristics:

- `aubio.Pitch("default", ...)` resolves to **`yinfft`** — the FFT-based autocorrelation YIN
  variant. This is the same algorithm family used in `harmonica-tabs`.
- The actual `yinfft` implementation is C code compiled to WebAssembly. It is mature, heavily
  tested on real-world audio, and runs off the main thread in WASM.
- The app is chromatic, not harmonica-aware.
- Stabilization is light: the UI only updates when the same note **name** (e.g. "C", "G#")
  appears twice consecutively. Note name ignores octave, so C3 and C4 both satisfy a "C"
  repeat — a loose check.
- There is no confidence gate. Any non-zero frequency returned by aubio is accepted.
- There is no tolerance window. If aubio returns a frequency 80 cents from any standard note,
  the UI shows that note anyway.
- There is no signal hold. When aubio returns 0 (silence), the UI shows nothing.

## How `harmonica-tabs` Works

### 1. It builds a harmonica-specific note vocabulary

The app starts from the transposed Richter layout and builds the full set of playable notes for
the selected harp key, including bends and overbends. Duplicate MIDI values are collapsed to the
"easiest" technique.

Relevant file: `harmonica-tabs/src/logic/harmonica-frequencies.ts`

### 2. It runs a custom FFT-based YIN detector

For single-note detection, `harmonica-tabs` uses a custom TypeScript implementation of the
`yinfft` algorithm — the same algorithm that aubio uses as its default. The FFT autocorrelation
path was specifically chosen (over time-domain YIN) because harmonica harmonics caused the
time-domain CMND running sum to inflate above 1 at the true fundamental's lag, making detection
impossible.

Relevant file: `harmonica-tabs/src/logic/fft-detector.ts`

Key constants:

- `MIN_RMS = 0.005` — silence gate, applied before YIN runs. Same value on web and native
  (both platforms share this TypeScript code).
- `YIN_THRESHOLD = 0.15` — the CMND threshold below which a lag is accepted as a fundamental.
  This is the same default threshold used by aubio's `yinfft`.

The detector:

- rejects low-RMS frames,
- derives the lag search range from the harmonica vocabulary (min/max note frequencies ±10%),
- estimates the fundamental with FFT-based YIN,
- finds the nearest vocabulary note in cents,
- rejects the result if it is outside a per-technique tolerance window,
- returns the **snapped vocabulary frequency**, not the raw detected fundamental.

That last point matters. If the raw estimate is one octave low but still within tolerance of a
legal harmonica note, the app reports that note confidently.

### 3. It applies a confidence gate

After detection, a confidence value is computed as:

```
confidence = 1 - (nearestCents / centsTolerance)
```

where `centsTolerance` is 50 cents for natural notes, ~36 cents for bends, ~25 cents for
overblows.

The app then applies a `confidenceGate` of `0.2`, meaning any detection where the YIN
fundamental lands more than 40 cents from the nearest vocabulary note is rejected entirely.

Relevant file: `harmonica-tabs/src/config/default-settings.ts` (`confidenceGate: 0.2`)

### 4. It applies a 400 ms signal hold

After a high-confidence detection, the last detected frequency is held for 400 ms. During that
window, if confidence drops below the gate, the snapshot continues to report the held note.
This affects tone-follow advancement.

Relevant file: `harmonica-tabs/src/hooks/use-audio-listening.ts` (`signalHoldMs: 400`)

### 5. Per-frame results now surface directly

As of recent work, `SMOOTHING_WINDOW = 1` and `SMOOTHING_MIN_VOTES = 1`. The smoothing buffer
effectively passes through the current frame's detection directly. There is no longer any
multi-frame vote accumulation that could delay or suppress a correct single-frame result.

This is a significant change from the earlier state described in previous versions of this
document (SMOOTHING_WINDOW was 5, SMOOTHING_MIN_VOTES was 3), which caused a
systematic one-note lag when playing at moderate tempo.

## What Changed in This Investigation Round

| Parameter | Before | After |
|---|---|---|
| `SMOOTHING_WINDOW` | 5 | 1 |
| `SMOOTHING_MIN_VOTES` | 3 | 1 |
| Native frame throttle | none | 40 ms Swift floor + configurable JS interval |
| Progressive queue buildup | present | fixed |

The smoothing changes removed the largest source of UI lag (multi-frame vote accumulation
that caused old notes to persist). The throttle changes fixed a growing queue buildup on
native that caused latency to increase unboundedly over time.

## Remaining Gaps

After the above changes, the detected performance gap between `tuner` and `harmonica-tabs` is
narrower but still present. The most plausible remaining causes, in order of likely impact:

### 1. The confidence gate creates a second filter above the YIN threshold

YIN already rejects frames where no CMND dip below 0.15 is found. The confidence gate of 0.2
then rejects any frame where the snapped note is more than 40 cents from the YIN fundamental.

This means two independent rejection stages:
- Stage 1 (YIN): no periodic pitch found
- Stage 2 (confidence gate): pitch found but too far from nearest vocabulary note

Tuner has only stage 1 (implicit in aubio returning 0). Stage 2 silently drops detections that
a human would consider "close enough," particularly during note onset, note release, and
expressive playing with embouchure variation.

**Experiment**: set `confidenceGate` to `0.0` in `default-settings.ts` and observe whether
more correct notes surface (at the cost of potentially more false positives).

### 2. The centsTolerance window itself may be too tight

For natural notes the effective acceptance window after the confidence gate is applied is:

```
tolerance × (1 − confidenceGate) = 50 × 0.8 = 40 cents
```

A real harmonica reed played with any vibrato or embouchure drift can easily be 30–45 cents
sharp or flat while still being unambiguously the intended note. Notes near the edge of this
window get rejected without the user knowing.

**Experiment**: increase natural-note `confidenceThreshold` from `0.3` to a lower value in
`harmonica-frequencies.ts`, which widens the `centsTolerance` for those notes.

### 3. The signal hold can propagate a wrong detection for 400 ms

With `SMOOTHING_WINDOW = 1`, a wrong detection now corrects immediately on the next frame.
But the 400 ms signal hold in `getAudioSnapshot` means the tone-follow snapshot continues
to report the held (wrong) note for up to 400 ms after confidence drops below the gate.

In practice: play a wrong note briefly, confidence drops, hold kicks in. The tone-follow
cursor can advance to the wrong tab position and remain there for up to 400 ms before
self-correcting.

**Experiment**: reduce `signalHoldMs` from 400 to 100–150 ms and observe whether tone-follow
becomes more self-correcting without losing note continuity during brief breath pauses.

### 4. C/WASM vs TypeScript for the same algorithm

Both apps now use `yinfft`. The difference is that aubio's implementation is optimized C code
compiled to WebAssembly, while `harmonica-tabs` uses a TypeScript implementation. Both follow
the same mathematical specification, but:

- aubio's implementation has had years of production use and edge-case hardening on real
  instrument recordings.
- The TypeScript implementation was validated on sine waves; real harmonica timbre may expose
  edge cases not yet encountered.

This is the hardest gap to close without a significant architectural change (e.g. adding aubio
as a WASM dependency). It is worth investigating only after the simpler parameter changes
above have been tested.

### 5. Tuner's note-name stabilization is more permissive on octaves

Tuner updates the display when the same note **name** appears twice ("G", "B"). This means
G3 and G4 both satisfy "G" — the check ignores octave.

For a chromatic tuner this is appropriate. For harmonica-tabs it is not directly applicable
(G3 and G4 are different holes), but it does mean tuner is less sensitive to octave-estimation
instability in the underlying detector. `harmonica-tabs` snaps to a specific MIDI note, so
an octave error produces a visibly wrong tab position rather than a stabilized note name.

## Cross-Platform Notes

Both web and native now share the same `MIN_RMS = 0.005` silence gate (defined in
`fft-detector.ts`, which runs on both platforms). Earlier versions of this document incorrectly
stated that iOS used a different RMS threshold.

On native iOS, the audio chain additionally includes:
- A 40 ms Swift-side frame emission floor (`HarmonicaAudioModule.swift`)
- A configurable JS-side interval (default 80 ms, exposed in the debug properties panel)

These controls are visible in Properties → Show debug → "Frame interval (ms)". They do not
affect detection quality, only throughput.

## Bottom Line

`tuner` feels better for two remaining reasons, in descending order of impact:

1. **No second confidence gate.** It accepts any non-silent pitch from aubio. `harmonica-tabs`
   silently rejects detections that are "too far" from the nearest vocabulary note, which
   includes many notes played with embouchure variation or during onset.

2. **Production-hardened C/WASM implementation.** Same algorithm, but aubio has been tested
   on real-world instrument recordings far more extensively than the custom TypeScript version.

The most impactful low-risk experiment is lowering or removing the `confidenceGate` and
observing whether correct detections increase more than false positives do.
