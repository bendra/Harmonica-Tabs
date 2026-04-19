# Pitch Detection Comparison: `tuner` vs `harmonica-tabs`

## Goal

This note compares the open-source app in [`tuner/`](/workspaces/codespaces-blank/tuner) with the current pitch-detection path in [`harmonica-tabs/`](/workspaces/codespaces-blank/harmonica-tabs), with special attention to why `tuner` can feel more reliable for note detection on a G harmonica.

This is source-based analysis only. No production code was changed.

## Short Version

`tuner` uses a mature external pitch detector from `aubio` and then maps the returned frequency onto ordinary chromatic notes. Its pipeline is simple and mostly general-purpose.

`harmonica-tabs` uses a custom YIN-based detector, then snaps the result into a harmonica-specific vocabulary, then adds multiple layers of smoothing, confidence gating, hold behavior, and app-specific matching rules.

That means:

- `harmonica-tabs` has more musical context, which is good when the raw pitch is already correct.
- `harmonica-tabs` also has more places where a mostly-correct signal can be rejected, delayed, or made to look confidently wrong.
- If the first-stage pitch estimate lands on the wrong octave, the harmonica vocabulary can turn that into a valid-looking harmonica note instead of exposing uncertainty.
- The current automated tests prove the detector works on pure sine waves, but they do not prove it works well on real harmonica timbre.

My current read is that the problem is probably not just "the detector algorithm is bad." It is more likely a combination of:

1. Real-world pitch estimation being harder than the test coverage reflects.
2. Harmonica-specific snapping making octave mistakes look authoritative.
3. Extra smoothing and gating making the final app feel less responsive or less reliable than the raw detector actually is.

## How `tuner` Works

The pitch path in `tuner` is compact:

1. It opens the microphone with `getUserMedia`.
2. It creates a `ScriptProcessor` with a `4096`-sample buffer.
3. For each audio callback, it passes the raw channel buffer to `aubio.Pitch("default", 4096, 1, sampleRate)`.
4. It converts the returned frequency to a chromatic MIDI note and cents offset.
5. The UI updates after the same note name is seen twice in a row.

Relevant files:

- [`tuner/app/tuner.js`](/workspaces/codespaces-blank/tuner/app/tuner.js)
- [`tuner/app/app.js`](/workspaces/codespaces-blank/tuner/app/app.js)

Important characteristics:

- The actual pitch estimation is outsourced to `aubio`, not implemented in this repo.
- The app is chromatic, not harmonica-aware.
- It does not try to decide which harmonica hole or technique produced the note.
- It does only light stabilization in the UI: note-name repetition, not majority-vote smoothing over several frames.

One important honesty note: from local source alone, I can see that `aubio.Pitch("default", ...)` is used, but I cannot prove which exact aubio backend algorithm that resolves to in this build without external documentation or stepping into the bundled library.

## How `harmonica-tabs` Works

`harmonica-tabs` has a more layered pipeline.

### 1. It builds a harmonica-specific note vocabulary

The app starts from the transposed Richter layout and builds the full set of playable notes for the selected harp key, including bends and overbends. Duplicate MIDI values are collapsed to the "easiest" technique.

Relevant file:

- [`harmonica-tabs/src/logic/harmonica-frequencies.ts`](/workspaces/codespaces-blank/harmonica-tabs/src/logic/harmonica-frequencies.ts)

This is musically useful, but it means the detector is not answering "what pitch exists in the microphone?" It is answering "which allowed harmonica note is closest?"

### 2. It runs a custom YIN-based single-note detector

For single-note detection, `harmonica-tabs` uses a custom time-domain YIN implementation. The comments explicitly say Goertzel was moved out of single-note detection because harmonica harmonics and subharmonics caused wrong-note picks.

Relevant file:

- [`harmonica-tabs/src/logic/fft-detector.ts`](/workspaces/codespaces-blank/harmonica-tabs/src/logic/fft-detector.ts)

The detector:

- rejects low-RMS frames,
- derives min/max search range from the harmonica vocabulary,
- estimates a fundamental with YIN,
- finds the nearest vocabulary note in cents,
- rejects the result if it is outside a technique-specific tolerance window,
- returns the snapped vocabulary frequency, not the raw detected fundamental.

That last point matters a lot. If the raw estimate is one octave low but still close to a legal note on the current harp, the app can report a clean, valid harmonica pitch.

### 3. It applies additional app-level smoothing and gating

After the detector returns a per-frame result, `useAudioListening` adds another layer:

- a 5-frame smoothing window,
- at least 3 votes for the same rounded MIDI value,
- a confidence gate of `0.2`,
- a 400 ms hold period for the last detected signal.

Relevant file:

- [`harmonica-tabs/src/hooks/use-audio-listening.ts`](/workspaces/codespaces-blank/harmonica-tabs/src/hooks/use-audio-listening.ts)

This is a reasonable anti-jitter strategy, but it also means the note shown in the UI is not the raw detector output. It is a processed version that can:

- lag behind fast pitch changes,
- suppress short correct detections if they do not win the vote window,
- keep a stale pitch alive briefly after the player has changed notes,
- make octave flips feel "sticky" if the wrong octave dominates several recent frames.

### 4. It then matches that frequency into UI behaviors

The resulting frequency is fed into tab matching, in-tune highlighting, and transposer follow behavior.

Relevant files:

- [`harmonica-tabs/src/logic/pitch.ts`](/workspaces/codespaces-blank/harmonica-tabs/src/logic/pitch.ts)
- [`harmonica-tabs/src/logic/transposer-follow.ts`](/workspaces/codespaces-blank/harmonica-tabs/src/logic/transposer-follow.ts)
- [`harmonica-tabs/App.tsx`](/workspaces/codespaces-blank/harmonica-tabs/App.tsx)

So by the time a user sees a note, several layers have already interpreted the signal.

## Biggest Architectural Difference

The central difference is:

- `tuner` is a general pitch app that asks, "What note am I hearing?"
- `harmonica-tabs` is a harmonica UX that asks, "Which allowed harmonica note should this frame count as?"

That is an important product difference, not just an implementation detail.

The harmonica-aware approach has real benefits:

- it can reject impossible notes,
- it can map directly to tabs,
- it can use stricter tolerances for bends and overbends,
- it can drive tone-follow behavior directly.

But it also creates a failure mode that `tuner` largely avoids:

- if the raw pitch estimate is wrong, `harmonica-tabs` may still snap it to a plausible harmonica note and present that as a confident result.

In a plain tuner, a bad raw pitch estimate is easier to spot because the system is not trying to reinterpret it through instrument rules.

## Why `tuner` May Feel Better on G Harmonica

I do not think the source supports saying "aubio is definitely better in all ways." But it does support several plausible reasons that `tuner` feels better in practice.

### 1. `tuner` likely exposes the raw detector more directly

Its UI applies only a small amount of stabilization. `harmonica-tabs` adds vocabulary snapping, confidence filtering, vote smoothing, and hold logic before the note becomes user-visible.

So even if the raw detectors were equally good, `tuner` could still feel more accurate because less interpretation happens after detection.

### 2. G harmonica makes octave mistakes more damaging

The repo already has an explicit TODO about G harmonica notes being detected one octave too low.

Relevant file:

- [`docs/TODO.md`](/workspaces/codespaces-blank/docs/TODO.md)

That aligns with a classic low-note problem: lower fundamentals are harder to estimate robustly from real reed timbre, especially when strong harmonics or breath noise are present.

Even though the custom YIN implementation is intended to reduce octave errors, real instruments are harsher than clean test tones.

### 3. Vocabulary snapping can hide detector ambiguity

`harmonica-tabs` does not surface "I heard something around here, but I am unsure." It snaps to the nearest allowed note if it is within tolerance.

That is useful for gameplay-like UX, but it can make a detector bug feel worse:

- a chromatic tuner may flicker between uncertain values,
- a harmonica-aware app may show the wrong hole/note confidently.

### 4. Majority-vote smoothing can promote the wrong answer

If the raw detector oscillates between the correct pitch and a lower-octave candidate, the 5-frame / 3-vote smoothing step can turn that unstable stream into a stable wrong answer.

This is especially relevant if the wrong octave is slightly easier for the detector to find during attack or on quieter frames.

### 5. Real-world coverage is weaker than the code comments suggest

The tests for `harmonica-tabs` use generated sine waves, including a G harmonica vocabulary test.

Relevant file:

- [`harmonica-tabs/tests/logic/fft-detector.test.ts`](/workspaces/codespaces-blank/harmonica-tabs/tests/logic/fft-detector.test.ts)

That proves:

- the YIN implementation can identify ideal frequencies,
- the note vocabulary mapping logic works on ideal inputs,
- the G harmonica note list itself is not obviously broken.

It does not prove:

- correct behavior on real harmonica recordings,
- stable octave selection on reed-rich timbre,
- stable detection during attack/transient phases,
- comparable behavior between web, iOS, and Android microphone input.

## Cross-Platform Note

`harmonica-tabs` uses the same overall YIN approach on web, iOS, and Android, but not perfectly identical runtime conditions.

Relevant files:

- [`harmonica-tabs/src/logic/web-audio.ts`](/workspaces/codespaces-blank/harmonica-tabs/src/logic/web-audio.ts)
- [`harmonica-tabs/modules/harmonica-audio/ios/HarmonicaAudioModule.swift`](/workspaces/codespaces-blank/harmonica-tabs/modules/harmonica-audio/ios/HarmonicaAudioModule.swift)
- [`harmonica-tabs/modules/harmonica-audio/android/src/main/java/expo/modules/harmonicaaudio/HarmonicaAudioModule.kt`](/workspaces/codespaces-blank/harmonica-tabs/modules/harmonica-audio/android/src/main/java/expo/modules/harmonicaaudio/HarmonicaAudioModule.kt)

Notable detail:

- web and Android use an RMS silence gate of `0.005`,
- iOS uses `0.001`.

That inconsistency alone does not explain the G issue, but it is a reminder that the app’s behavior is not purely algorithmic. Platform capture details and thresholds also matter.

## My Best Current Explanation

Based on source alone, the most likely story is:

1. `harmonica-tabs` has a reasonable custom detector design.
2. Its idealized tests are too easy compared with real harmonica audio.
3. On real G harmonica notes, some frames likely land on the wrong octave.
4. The harmonica-specific snap-to-vocabulary step converts those octave mistakes into valid note outputs.
5. The smoothing layer then stabilizes whichever octave wins enough recent frames.
6. The user experiences that final stabilized result as "unreliable detection," even if the deeper issue starts earlier in the pipeline.

That would also explain why a simpler chromatic tuner can feel better even without any harmonica-specific intelligence.

## What This Comparison Suggests For Future Investigation

Without changing code yet, I would investigate in this order:

1. Log the raw fundamental from YIN before vocabulary snapping.
2. Log the snapped note chosen from the harmonica vocabulary.
3. Log the pre-smoothing stream versus the final smoothed frequency.
gi5. Compare the same real sample through `tuner` and `harmonica-tabs` frame by frame.

That order is beginner-friendly and low-risk because it separates:

- raw pitch estimation,
- note snapping,
- smoothing,
- UI interpretation.

If we skip that separation, it will be very hard to tell whether the real bug is:

- the detector,
- the vocabulary mapping,
- the smoothing thresholds,
- or the final UI matching logic.

For a proposed first-pass recording format, see [`docs/RECORDING_DATASET_SPEC.md`](/workspaces/codespaces-blank/docs/RECORDING_DATASET_SPEC.md).

## Bottom Line

`tuner` is better at one narrow job: general note detection with a mature external detector and very little post-processing.

`harmonica-tabs` is trying to do a harder job: note detection plus harmonica-specific interpretation plus tone-follow UX.

So the comparison does not point to one simple conclusion like "replace YIN" or "copy `tuner` exactly." The stronger conclusion is:

- `tuner` is probably winning because its signal path is simpler and less opinionated after raw detection.
- `harmonica-tabs` is more likely losing reliability in the interaction between raw pitch estimation, harmonica-specific snapping, and smoothing than in any one isolated file.
