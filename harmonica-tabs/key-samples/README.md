# Key-detection test corpus

Labelled audio clips for evaluating the "Find song key" detector with
`npm run key-detect-offline`. This is how we measure the detector against
reproducible audio **before** changing live behavior — change one thing, re-run,
keep it only if MIREX and playability both improve.

## What's tracked vs ignored

- **Ignored** (not committed): the audio files themselves (`*.wav`, `*.mp3`, …).
  They're copyrighted and/or large. See the root `.gitignore`. Keep your clips
  here locally; they just don't get pushed.
- **Tracked** (committed): `labels.json` (the manifest), `results/*.json` (eval
  runs, so improvements/regressions show as a diff), and this README.

## Adding clips

1. Download or record a clip whose key you know. Convert to WAV:
   `ffmpeg -i in.mp3 -ac 1 out.wav`  (or `sox in.mp3 -c 1 -b 16 out.wav`).
2. Put the `.wav` in this folder.
3. Give it a label — either way works (the harness prefers `labels.json`):
   - **Filename:** end the name with `__<Note>_<quality>`, e.g.
     `summertime__A_minor.wav`, `there_she_goes__D_major.wav`, `tune__Bb_minor.wav`.
   - **labels.json:** add an entry (lets you record source/license/tuning too).

### Trust the labels, not the titles

YouTube titles are often wrong, or name the *relative*/*parallel* key. And not
every track is tuned to A440. Spot-check by ear or with a tuner/reference app,
and record anything odd in the entry's `tuningHz` / `notes`.

### Aim for breadth

Cover all 12 tonics, both major and minor, and varied instrumentation (solo
guitar, full band, drum-heavy, blues shuffle). ~20–40 clips already gives signal.

## labels.json format

```json
{
  "clips": [
    {
      "file": "summertime__A_minor.wav",
      "tonic": "A",
      "quality": "minor",
      "source": "https://youtube.com/watch?v=...",
      "license": "YouTube (local only — do not commit audio)",
      "tuningHz": 440,
      "notes": "live band, drums prominent"
    }
  ]
}
```

`file`, `tonic`, `quality` are required; the rest is provenance. `tonic` is a
note name (`A`, `Bb`, `F#`); `quality` is `major` or `minor`.

## Reading the report

- **MIREX score** — the headline. 1.0 = exact; partial credit for near-misses
  (fifth 0.5, relative 0.3, parallel 0.2). One comparable number across runs.
- **Playability** — the product-truth companion metric. It asks whether the
  scale a player would use from the detected key fits the true key's notes.
- **Confusion breakdown** — *where* the error is. Lots of `fifth`/`relative`
  confusions → a back-end (key-profile/weighting) issue; lots of `other` →
  the chroma front-end isn't even capturing the right notes.
- **Per-quality / per-tonic** — which keys and which mode (major vs minor) fail.
- **Confidence calibration** — whether `confidence` predicts correctness, i.e.
  whether the `KEY_CONFIDENCE_MIN` accept/reject gate is set sensibly.
- **Chroma sparkline** — eyeball whether the expected scale tones actually peak.
- **Whole-clip vs ~6s window** — the app only hears ~6s, so the window numbers
  predict real-world behaviour; whole-clip is the easier upper reference.

Every run writes both:

- `results/<timestamp>.json` — full report for every front-end variant.
- `results/baseline-candidate.json` — live-default-only, baseline-compatible report.

To update the regression baseline from the current local WAV corpus, run:
`npm run key-detect-offline -- ./key-samples --update-baseline`.
