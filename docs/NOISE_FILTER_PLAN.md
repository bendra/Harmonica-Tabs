# Plan: Background Noise Filter

## Context

Background noise (fans, HVAC, etc.) can exceed the fixed RMS silence gate
(`MIN_RMS = 0.005` in `fft-detector.ts`), causing spurious note detections in
noisy environments. The fix is **auto-calibration at listen start**: spend the
first ~1 second measuring the ambient noise floor, then raise the effective gate
dynamically for that session. A toggle in the properties screen lets users
disable it if needed.

This does not change `fft-detector.ts` — calibration and per-frame gating
happen entirely in `use-audio-listening.ts`, which already receives each
frame's `rms` value and owns the ring-buffer smoothing logic.

---

## Changes

### 1. `src/hooks/use-audio-settings.ts`

Add one boolean setting (default `true`):

```typescript
const [noiseFilterEnabled, setNoiseFilterEnabled] = useState(true);
```

Return `noiseFilterEnabled` and `setNoiseFilterEnabled` from the hook.

---

### 2. `src/hooks/use-audio-listening.ts`

Add `noiseFilterEnabled: boolean` to `AudioListeningParams`.

New constants (top of file):
```typescript
const CALIBRATION_FRAMES = 10;       // ~1 second of audio frames
const NOISE_FLOOR_MULTIPLIER = 4;    // gate = 4× measured ambient RMS
const CALIBRATION_BAIL_RMS = 0.1;    // if ambient this loud, skip calibration (user was already playing)
```

New refs:
```typescript
const calibrationRmsRef = useRef<number[] | null>(null); // null = not calibrating
const calibratedMinRmsRef = useRef<number>(0);           // 0 = no calibration active
```

New state:
```typescript
const [isCalibrating, setIsCalibrating] = useState(false);
```

In `startListening()`, if `noiseFilterEnabled`, kick off the calibration window:
```typescript
calibrationRmsRef.current = [];
calibratedMinRmsRef.current = 0;
setIsCalibrating(true);
```

In the per-frame callback, add at the top (before the ring-buffer push):
```typescript
const calFrames = calibrationRmsRef.current;
if (calFrames !== null) {
  calFrames.push(update.rms);
  if (calFrames.length >= CALIBRATION_FRAMES) {
    const minRms = Math.min(...calFrames);
    const candidate = minRms * NOISE_FLOOR_MULTIPLIER;
    // If ambient was too loud (user already playing), skip calibration.
    calibratedMinRmsRef.current = candidate < CALIBRATION_BAIL_RMS ? candidate : 0;
    calibrationRmsRef.current = null;
    setIsCalibrating(false);
  }
  return; // suppress all detection output during calibration window
}
```

When building the frequency to push into the smoothing ring buffer, apply the
calibrated gate:
```typescript
const effectiveFrequency =
  calibratedMinRmsRef.current > 0 && update.rms < calibratedMinRmsRef.current
    ? null          // below calibrated noise floor → treat as silence
    : update.frequency;

buf.push(effectiveFrequency);
// (rest of ring-buffer logic unchanged)
```

In `stopListening()`, reset calibration state:
```typescript
calibrationRmsRef.current = null;
calibratedMinRmsRef.current = 0;
setIsCalibrating(false);
```

Return `isCalibrating` from the hook.

---

### 3. `App.tsx`

**Wire up the new setting and state:**
```typescript
const { noiseFilterEnabled, setNoiseFilterEnabled, ... } = useAudioSettings();
const { isCalibrating, ... } = useAudioListening({ ..., noiseFilterEnabled });
```

**Calibrating indicator** — near the Listen button, show a small "Calibrating…"
label when `isCalibrating` is true. It disappears automatically when calibration
finishes (~1 second). Style to match the existing muted status labels.

**Properties toggle** — in the properties screen's audio/listening section, add:

```
Background noise filter   [Switch]
Measures silence when you start listening and filters it out.
```

Use React Native `Switch` with `value={noiseFilterEnabled}` and
`onValueChange={setNoiseFilterEnabled}`. Follow the existing style for the
debug/other toggles already in that section.

---

## What does NOT change

- `fft-detector.ts` — no interface change
- `web-audio.ts` / `native-audio.ts` — unchanged
- Existing tests — unaffected; all new logic is in the hook
- Behaviour when `noiseFilterEnabled = false` — identical to today (no calibration, no delay)

---

## Noisy reference recordings

Before implementing, record a dedicated "noisy" take for at least one harmonica
key with background noise present (fan, HVAC, etc.). Use `scripts/record-samples.sh`
and label it as the noisy take in comments or by convention (e.g. take 3 for G
harmonica = recorded with fan on).

Running `npm run detect-offline` on that take shows the baseline problem: wrong
notes on frames where the noise exceeds the fixed RMS gate. Keep this take after
implementation — it remains useful as a regression baseline if the algorithm changes.

**Note:** `detect-offline` calls `detectSingleNote()` directly and bypasses the
hook, so it cannot simulate the noise filter itself. The filter is verified
through live app testing (steps 2–5 below). If offline simulation is ever needed,
a `--noise-floor <rms>` flag could be added to `detect-offline.ts` to apply the
same RMS gate inline — defer this until there's a clear need.

---

## Verification

1. `npm test` — all existing tests pass
2. `npm run detect-offline` — run against the noisy take to confirm the problem
   is visible before the fix (wrong notes on noisy frames).
3. **Quiet environment**: enable filter, press Listen, see brief "Calibrating…"
   label (~1 sec), then detection works as normal.
4. **Noisy environment** (fan, HVAC): without filter, spurious detections appear;
   with filter on, silence is correctly maintained until a note is played clearly
   above the noise floor.
5. **Properties toggle off**: no calibration phase, no delay — current behaviour.
6. **Early playing**: start playing before calibration ends — bail threshold kicks
   in, calibration is skipped, detection continues with default MIN_RMS gate.
