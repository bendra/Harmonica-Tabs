## Plan: Native Audio + Realtime Note/Chord Recognition

TL;DR: Extend the existing Web Audio pitch detector into a platform-agnostic audio service, add native audio capture for Expo mobile, preserve the current note-match pipeline, and layer polyphonic/chord detection in a second phase.

**Steps**
1. Identify and isolate the audio input abstraction.
   - Create a reusable detector API around `createWebAudioPitchDetector` in `harmonica-tabs/src/logic/web-audio.ts`.
   - Add a new adapter interface for platform audio providers (`AudioPitchDetector` and `AudioUpdate` types).
   - Target files: `harmonica-tabs/src/logic/web-audio.ts`, `harmonica-tabs/src/hooks/use-audio-listening.ts`.

2. Implement native mobile microphone capture.
   - Choose an Expo-native audio capture layer such as `expo-av` or a lightweight raw audio recorder library.
   - Add a native audio module/adapter under `harmonica-tabs/src/logic/native-audio.ts` or `harmonica-tabs/src/logic/mobile-audio.ts`.
   - Ensure it exposes `isSupported`, `start`, and `stop` with the same callback shape as the web detector.
   - Handle permission requests and microphone availability gracefully.

3. Reuse or port pitch detection logic for native input.
   - Port the current autocorrelation pitch detection algorithm from `harmonica-tabs/src/logic/web-audio.ts` into a shared helper that can process raw PCM frames regardless of source.
   - Keep the same frequency range, RMS gating, and smoothing behavior.
   - If the native platform module can provide raw Float32 PCM, feed it through the same detector.
   - If the native module provides only audio buffers in another format, add a conversion step.
   - Target files: `harmonica-tabs/src/logic/web-audio.ts`, + new shared helper file if needed.

4. Wire native audio into the app listening hook.
   - Update `harmonica-tabs/src/hooks/use-audio-listening.ts` to choose the adapter based on platform and support.
   - Preserve the current fallback to simulated Hz when mic access is unavailable or unsupported.
   - Keep the same hold buffer, confidence gate, and audio snapshot output shape.

5. Add unit tests for the new abstraction and mobile adapter behavior.
   - Add tests for the shared detector helper to ensure identical note detection semantics.
   - Add tests for `use-audio-listening.ts` behavior with a mocked native adapter.
   - Target folder: `harmonica-tabs/tests/logic`.

6. Add basic native audio UI / device support validation.
   - Update docs or README to call out that native audio is now expected on mobile builds.
   - Consider adding a small `mic supported` indicator in the app if needed.
   - Target files: `harmonica-tabs/App.tsx`, `README.md`.

7. Phase 2: Add chord recognition support.
   - Keep this separate from the first phase because polyphonic detection is an advanced feature.
   - Add a new chord-detection module that receives multiple detected pitch candidates and produces chord/note-set matches.
   - Integrate with the current tab matching pipeline only after single-note detection is stable.
   - Target new files: `harmonica-tabs/src/logic/chord-recognition.ts`, `harmonica-tabs/src/logic/chord-tabs.ts`.

**Relevant files**
- `harmonica-tabs/src/logic/web-audio.ts` — existing pitch detector and audio capture entrypoint.
- `harmonica-tabs/src/hooks/use-audio-listening.ts` — current microphone hook and UI snapshot.
- `harmonica-tabs/src/logic/pitch.ts` — frequency/MIDI conversion and note-to-tab matching.
- `harmonica-tabs/src/logic/transposer-follow.ts` — tone-follow evaluation state machine.
- `harmonica-tabs/App.tsx` — app orchestration and UI integration.
- `harmonica-tabs/tests/logic` — add tests for detection and platform adapter.

**Verification**
1. On web, confirm existing note-following behavior still works with the new shared detector helper.
2. On Expo mobile, confirm microphone permission request succeeds and note detection begins.
3. Validate fallback behavior: blocked mic or unsupported device still uses simulated Hz.
4. Add unit tests covering the new platform-agnostic detector and `use-audio-listening` adapter selection.
5. Verify the app can still render correct caret matching and transposer-follow behavior after the audio refactor.

**Decisions**
- Native audio capability should be implemented as a parallel adapter to the existing web detector, not by rewriting the whole tone-follow logic.
- Chord recognition is scoped as a second-phase extension because it requires a different detection model and matching semantics.
- The app should preserve the current simulated-Hz fallback and not remove it during native audio rollout.

**Further considerations**
1. Clarify native audio target platforms: Expo Go only, dev build, or production native binary? If you want full native support beyond Expo Go, we may need a slightly different library selection.
2. Clarify chord recognition expectation: do we need support for two-note dyads only, or full 3+-note chord detection? The implementation complexity scales significantly.
3. If accurate native pitch detection is critical, consider whether to use a native DSP/pitch library instead of a pure-JS autocorrelation port.