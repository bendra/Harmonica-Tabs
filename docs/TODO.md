# TODO / Next Steps

- Implement background noise filter (auto-calibration at listen start + properties toggle) — see `docs/NOISE_FILTER_PLAN.md`; this also replaces the older fixed native RMS-gate follow-up.
- Revisit tab ordering and octave handling if alternate tunings are added.
- Consider surfacing the current octave offset in the transposer UI if repeated `Down` / `Up` stepping proves hard to track.
- Consider exposing chord logic as a pure helper to test more directly.
- Revisit whether the `Scales` screen should add a tablet-only two-column layout after the new size tiers have been user-tested.
- Validate the new `Scales` / `Tabs` workspace naming after more user testing.
- Validate whether the editor `Cancel` wording and `Choose Tab` wording are clear enough for first-time users.
- Revisit `-2` vs `3` toggle behavior for chord visualization.
- Expand transposer parser support for more legacy tab notations (if needed).
- Add copy/share actions for transposer output.
- Consider whether the transposer's compact current-source label needs richer source metadata if users miss the removed source preview card.
- Harden the native detector adapter against listen start/stop races: make native startup reuse one in-flight session, ensure stale listeners are removed, and guarantee cleanup when native start fails.
- Harden Android `AudioRecord` initialization errors specifically so native startup failures always clean up and reliably fall back to the existing simulated listen flow.
- Consider a helper hint for the editor `Clean Input` flow if users need more guidance after the custom pad removal.
- Expand the saved-tab library viewer with search/filter, sort options, larger previews, and future multi-select actions.
- Consider whether the library screen should grow rename/duplicate entry points in addition to the editor-level `Save As` flow.
- Add library import/export so users can share or back up their saved tabs, likely starting with whole-library JSON export/import.
- Consider single-tab sharing/export flows after whole-library import/export exists.
- Consider cross-device sync only after local import/export proves useful.
- Add a performance mode: a single toggle that enlarges the Main Tab Row chips and increases contrast for on-stage use, without affecting controls or arpeggios — scoped to the existing layout tier system rather than a general font-size preference
- Revisit the saved-context open prompt after user testing, especially whether the current-harp option text clearly communicates that it preserves the saved song key rather than the saved position number.
- Consider whether the library should expose an explicit “clear saved context” or “edit saved context” affordance beyond reopening the editor and toggling `Save with key/position context`.
- Set up a Puppeteer or Playwright MCP server for live browser observation (useful for debugging resource leaks, audio lifecycle, and runtime behavior without relying on manual screenshots)
- Consider extracting remaining App.tsx layout/caret tracking into a `useScaleLayoutTracking` hook if that section grows unwieldy
- Improve tone-follow cursor behavior during tab playback: instead of advancing the cursor as soon as a note is held long enough, pulsate/highlight the current note while it is being held, then advance the cursor only when the tone stops or changes — and indicate whether the note was played correctly.
- Revisit the new split listen policies after user testing: `Tabs` now uses a faster responsive commit path while `Scales` keeps the conservative stable path; if players want more control later, prefer named responsiveness presets over a raw smoothing slider.
- Improve repeated-note tone follow after the offline frame/hop diagnostics: `scripts/detect-offline.ts` shows that smaller/overlapped windows can recover missed repeated-note advances (`1024/512` recovers the current C-harmonica take 2 failures), but they also expose more wrong-note/wrong-octave frames on tricky samples. Prefer a focused detector/follow pass with regression tests over a blanket runtime default change.
- Investigate FFT detector confidence dropouts surfaced by `tests/integration/repeated-notes-follow.test.ts`. Four C-harmonica recordings in `KNOWN_DETECTOR_FAILURES` (take_2: `1_draw_x3`, `2_blow_x3`, `3_draw_x3`, `6_draw_x3`) fail because `detectSingleNote` returns `frequency=null, confidence=0` mid-note while RMS is well above the MIN_RMS gate. The follow algorithm has no pitch to react to, so the cursor never advances. Likely the same area as the frame/hop window TODO above. When fixed, remove the file(s) from `KNOWN_DETECTOR_FAILURES` and the integration test will automatically protect against regression.
- Validate the shared YIN octave-low correction on-device with native debug output, especially the originally observed C-harp high notes; current recorded offline samples are clean after the fix.
- After more iOS WebView audio soak testing, decide when to remove the temporary native fallback/debug controls: the Properties "Audio source (debug)" selector, the native AVAudioEngine detector path, and the native-only "Native send interval ms (debug)" tuning field. Keep `docs/WEBVIEW_AUDIO_SPIKE.md` as the validation record until that decision is made.
- Keep an eye on high-register detector/register-selection edge cases beyond octave-low YIN errors, especially if new E-harmonica hole 10 blow/draw samples reproduce a distinct issue.
- Improve arpeggio tone-follow feedback: replace the floating caret with per-note highlighting that shows which arpeggio note is currently being played (within tolerance), and add recognition of chords (multiple simultaneous notes).
- Key detection (`Find song key` on `Scales`) follow-ups:
  - **(Done) Labelled corpus + baseline established.** 14 clips in `key-samples/`, baseline in `key-samples/results/baseline.json`: MIREX 0.31, exact 2/14, minor 0/7, a systematic A-minor/C-major front-end bias (see `docs/STATE.md`). Worth growing toward ~20–40 clips (more tonics, more minor keys) for a firmer signal, but the front-end fix can start now. No algorithm change ships without a measured before/after on this corpus.
  - **Report the playability lens beside MIREX on every before/after.** The harness now also prints a playability score (notes the player would play over the *detected* key vs. the *true* key's scale; see `playabilityFor` in `scripts/key-detect-offline.ts`) — baseline ≈ 0.76. A front-end fix should move *both* MIREX and playability up; watch playability so a change that raises MIREX doesn't quietly make the consonant near-misses worse.
  - **(Deferred UX, not this round) Surface a small set of compatible keys/positions instead of one over-confident answer.** The baseline shows the detector is over-confident and wrong, but its misses are mostly note-sharing (relative/fifth) — so offering e.g. "Eb / Bb minor — try Bb cross harp" turns those near-misses into useful alternatives rather than hidden errors. Pairs naturally with `relativeKey`/`idiomaticHarpsForKey` already in `key-suggestions.ts`. Revisit after the front-end fix.
  - **Improvement backlog — order confirmed by the baseline's confusion profile** (the A-minor attractor + ubiquitous A/C chroma peaks point squarely at the chroma front-end, so #1–#2 lead):
    1. Harmonic/overtone suppression in the chroma (harmonic product spectrum or harmonic weighting) — targets `fifth` confusions from overtone bleed.
    2. Spectral whitening / log-magnitude / per-bin normalization — stops drums & distortion from dominating the chroma.
    3. Bass resolution — larger FFT or log-frequency/constant-Q mapping or bin interpolation (current `44100/4096 ≈ 10.8 Hz` bins are too coarse for low notes).
    4. Tuning estimation (global A4 offset) for non-A440 tracks.
    5. Alternative key profiles (Temperley / Gómez / Albrecht–Shanahan, tuned for audio vs. symbolic K–S) — a cheap, measured swap.
    6. Bass-note weighting to disambiguate major/minor and tonic (the `relative`/`parallel` axis is the detector's least-certain output).
    7. Segment selection vs. whole-clip averaging (skip intros/modulations).
  - Recalibrate `KEY_CONFIDENCE_MIN` from the harness's confidence-calibration buckets once accuracy improves (currently a conservative placeholder).
  - Consider supporting Find song key on the default iOS WebView audio path by computing the chromagram inside `webview-detector.html` (currently Find song key forces the native path on iOS).
  - Consider an in-app "analyze a recorded file" entry point (file picker + decode) — the pure `key-detector.ts` module already supports offline frames.
  - Revisit the major-vs-relative-minor disambiguation (the shakiest part); possibly weight the chroma by detected bass/root energy.
  - Add a Help "Reading the key suggestions" section (progressive disclosure: relative keys, what straight/cross/positions mean) so the live screen can stay terse.
  - Consider making the suggested harps in the guidance tappable to apply (currently informational text; apply always keeps the selected harp).
- accessibility
- localization
- Investigate errors encountered on ipad through idevicesyslog | grep harmonicatabs | grep \<Error\>
- Deferred (do not do unless needed): move YIN detection into Swift, emitting only `{ rawFrequency, clarity, rms }` and keeping harmonica snapping in shared TS (`fft-detector.ts` split into `yinCore` + `snapToVocabulary`). Revisit only if a slower/older device shows residual native detection lag at `minSendIntervalMs = 50`.
- Test-coverage gap: the core native perf fix (Swift producer-side rate limiting in `HarmonicaAudioModule.swift`) is not covered by Vitest — Swift is outside the JS test runner and there is no Swift test target. TS regression tests now guard the surrounding glue (`isStaleFrame`, `minSendIntervalMs` clamp/floor, and the detector live-update wiring), but the Swift accumulator/emit logic itself is only verified by on-device testing (see `docs/ARCHITECTURE.md` flow 5C). Adding a Swift unit-test target is a larger tooling change — ask before undertaking.
