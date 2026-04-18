# Audio Engineering Consultation — Harmonica Tabs App

## Context

I'm building a React Native / Expo app for harmonica practice. It shows sheet music
as harmonica tablature (hole numbers + blow/draw indicators) and uses the microphone
to follow along in real time — highlighting the current note as you play it. The app
runs on iOS, Android, and web.

I want to extend this to also detect **chords** (simultaneous notes), which harmonicas
can naturally produce by covering multiple holes at once.

The relevant constraint: unlike a piano or guitar, a harmonica's note vocabulary is
fully known in advance. For a given key (e.g. C or G), there are at most ~40 playable
notes (blow, draw, and bent variants). This turns a hard general pitch-detection
problem into a bounded lookup problem.

---

## What's Working

- Web audio detection (via Web Audio API) using the **YIN algorithm** works well on
  C and E harmonicas — notes register correctly with sub-50ms perceived latency.
- Temporal smoothing (ring buffer, require 3/5 frames to agree) eliminated most
  flickering.
- Native iOS/Android: just refactored to send raw PCM to JS, where the same YIN
  TypeScript code runs. Haven't confirmed this fully works yet.

---

## Current Problems

### 1. G harmonica octave errors (most pressing)

On a G harmonica, notes from the upper register (hole 4 and above, G5 and higher)
are consistently detected one octave too low. Hole 4 blow (G5 = 784 Hz) registers
as Hole 1 blow (G4 = 392 Hz). The shift is exact and systematic.

What I believe is happening: G harmonica reeds at higher pitches produce genuine
sub-harmonic energy at F/2. YIN's cumulative mean normalized difference (CMND) is
supposed to suppress sub-octave artifacts, but it seems the physical sub-harmonic
energy is strong enough to create a real minimum in the CMND at the lower frequency
before the true fundamental gets a chance to win.

Interestingly, this does NOT happen on C harmonica (same algorithm, same code).
My hypothesis: C harmonica's vocabulary range means the sub-harmonic of any note
falls *below* the search window (can't be found), while G harmonica's higher starting
pitch means the sub-harmonic of upper-register notes falls *within* the search window
and competes.

**Questions for Kris:**
- Is sub-harmonic reed vibration a known phenomenon? Is it more pronounced on higher-
  pitched harmonicas, or at higher pressures/blow angles?
- Is there a standard technique for octave disambiguation in pitch detectors?
  (e.g. prefer the shorter lag if both the detected lag AND its half pass a threshold?)
- We're using YIN_THRESHOLD = 0.15 (slightly relaxed from the paper's recommended
  0.10). Is there a better way to tune this for reeds vs. strings/voice?

### 2. Holes 1–3 on G harmonica don't register at all

The lower-register notes on G harmonica (G4, B4, D5 — holes 1-3) produce no
detection. YIN returns null — CMND apparently never dips below threshold for these
notes. Yet they're clearly audible.

**Questions for Kris:**
- What would cause a pitched note to have poor CMND periodicity? (Strong harmonics
  relative to the fundamental? Inharmonicity? Breath noise mixing with the tone?)
- G harmonica lower reeds are physically larger. Do they have different vibration
  characteristics that would make them harder to detect with time-domain methods?

### 3. Chord detection: Goertzel vs. alternatives

For chord detection (simultaneous notes), we're using the Goertzel algorithm — an
efficient single-bin DFT. We score each known frequency independently and declare
any note "active" if its score is above a relative threshold (e.g. ≥ 30% of the
strongest note's score).

Testing revealed that single reeds produce energy not just at harmonics (2×, 3×)
but also at perfect-fifth intervals (3/2×). E.g. playing B4 causes detectable
energy at F#5. This is a false-positive problem for chord detection.

We're planning two post-processing filters:
- **Breath direction filter**: all detected notes must be all-blow or all-draw
  (you can't blow and draw simultaneously)
- **Adjacency filter**: detected notes must occupy consecutive hole numbers
  (standard chord technique; tongue blocking not supported)

**Questions for Kris:**
- Is perfect-fifth interference (3:2 ratio) a documented phenomenon for free reeds?
  Why would it appear — is it a physical beating effect or acoustic resonance?
- Is Goertzel the right tool for chord detection given a bounded vocabulary, or is
  there something better suited?
- Do the two post-processing filters above seem like a sound approach, or are there
  known pitfalls?

---

## Architectural Questions

### Buffer size and latency

We're using 4096-sample buffers at 44100 Hz ≈ 93ms per frame. YIN's difference
function needs at least 2× the maximum lag, and our lowest note (G4 on G harmonica,
392 Hz) requires a max lag of ~125 samples, so 4096 gives us plenty of margin.

We run at roughly 10 detection frames/second.

- Is 93ms frame size reasonable for music practice, or would a professional tune
  this more aggressively? Perceived latency for the cursor catch-up feeling?
- Is there a reason to overlap frames (e.g. 50% overlap) for better temporal
  resolution, or would that just add complexity?

### Web Audio API vs. native

On web we use `AudioContext` with a `ScriptProcessorNode`. On native iOS we use
`AVAudioEngine` with an input tap. The raw iOS mic (`.measurement` mode, no AGC)
delivers ~5× quieter signal than browser `getUserMedia` (which applies automatic
gain). We compensate with a 5× gain factor before running detection.

- Is `.measurement` mode the right AVAudioSession category for a tuner? Is there
  a mode that would give us levels closer to what the browser provides?
- What's the standard approach for normalizing microphone input levels across
  platforms and devices?

### Algorithm architecture going forward

Current stack:
- **Single-note detection**: YIN (TypeScript, runs on both web and native)
- **Chord detection**: Goertzel (TypeScript, planned but not yet wired up to UI)

Alternative we haven't considered much: **HPS (Harmonic Product Spectrum)** —
downsamples the FFT spectrum and multiplies to reinforce the fundamental.

- Given the bounded-vocabulary constraint, is there a more purpose-built approach
  than general-purpose pitch detection that would be more robust?
- Is there an algorithm we're not considering that would handle both single-note
  AND chord detection well, or are these inherently separate problems?

---

## Meta Question

The app is a side project, not a commercial product. We're React Native developers,
not DSP engineers. We've been iterating through algorithm choices based on test
results rather than deep signal processing knowledge.

- Given what you know about how apps like GuitarTuna, Cleartune, or Spectroid work
  internally, are we in the right ballpark, or have we taken a fundamentally wrong
  turn somewhere?
- Is there an open-source tuner or pitch detection library (aubio, CREPE, TarsosDSP,
  pYIN) that we should just be wrapping instead of rolling our own?
