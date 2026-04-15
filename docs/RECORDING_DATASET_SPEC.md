# Recording Dataset Spec

## Goal

This document defines a simple, beginner-friendly recording format for real harmonica note samples that we can use to evaluate pitch detection more realistically than synthesized sine waves.

Version 1 is intentionally narrow:

- natural blow/draw notes only,
- one-note WAV files,
- one folder per harmonica key,
- no bends or overbends yet.

## Why This Exists

The current detector tests are useful, but they use ideal generated tones. Real harmonica notes have:

- breath noise,
- attack transients,
- reed timbre,
- harmonics and subharmonics,
- variation between holes that share the same pitch.

A small real-audio dataset helps us answer a more practical question:

"Does the detector work on actual harmonica playing?"

## Folder Layout

Recommended root folder:

- `test-audio/`

Recommended per-harmonica layout:

- `test-audio/G/`
- `test-audio/C/`
- `test-audio/A/`

Each harmonica folder should contain one file per natural hole/direction:

- `1-blow-take1.wav`
- `1-draw-take1.wav`
- `2-blow-take1.wav`
- `2-draw-take1.wav`
- ...
- `10-blow-take1.wav`
- `10-draw-take1.wav`

That is about 20 files per harmonica.

## Why We Organize By Hole/Direction

Use `hole-direction` filenames, not note-name filenames.

Example:

- good: `2-draw-take1.wav`
- less useful: `G4.wav`

Why:

- some pitches repeat across different holes,
- those holes can still sound different,
- debugging needs to preserve how the note was actually played,
- the app ultimately cares about playable harmonica notes, not only abstract note names.

## File Format

Use:

- WAV
- mono
- 44.1 kHz
- 16-bit PCM

This is a good default because it is easy to produce, easy to inspect, and avoids compression artifacts.

## Recording Shape

Each file should contain:

1. about 0.5 seconds of silence,
2. one clean note attack,
3. about 1.5 to 2 seconds of steady sustain,
4. a clean release,
5. about 0.5 seconds of silence at the end.

This matters because many detector failures happen during attack, not during the steady middle of a note.

## Recording Rules

Try to keep these constant across the dataset:

- same microphone,
- same distance from the harmonica,
- same room,
- same recording device,
- similar input gain,
- no clipping.

Also:

- play one hole at a time,
- do not apply EQ,
- do not apply noise reduction,
- do not apply reverb,
- do not export as MP3 or AAC first.

Best practice: keep the raw recording as untouched as possible. If the detector struggles, we want that to reflect the instrument and the algorithm, not editing.

## Minimum Useful Dataset

Smallest good first pass:

- one G harmonica,
- 20 files,
- one take per natural blow/draw note.

Better first pass:

- G harmonica and C harmonica,
- 20 files each,
- 3 takes per hole/direction.

Why that is better:

- G is the problem case,
- C is a comparison case,
- multiple takes help distinguish a detector problem from a single bad performance.

## Recommended Naming Convention

Simple version:

- `1-blow-take1.wav`
- `1-draw-take1.wav`

Expanded version if needed later:

- `G_1-blow_take1_clean.wav`
- `G_1-blow_take2_normal.wav`

Version 1 recommendation: keep names simple unless there is a clear reason to add more metadata.

## Optional Metadata File

Each harmonica folder can include a short `README.md` with:

- harmonica key,
- brand/model,
- recording device,
- microphone used,
- approximate mic distance,
- recording date,
- any unusual notes about the session.

Example:

```md
# G Harmonica Samples

- Key: G
- Model: Hohner Special 20
- Recorder: iPhone Voice Memos exported as WAV
- Distance: about 8 inches
- Room: quiet bedroom
- Notes: hole 2 draw was harder to hold steadily than the others
```

This is helpful because acoustic test data is easy to misunderstand later if session details are lost.

## What This Dataset Should Help Us Measure

With this dataset, we should be able to inspect:

- whether the detector picks the right note,
- whether it picks the wrong octave,
- whether some holes are much worse than others,
- whether G behaves worse than C,
- whether failures happen during attack, sustain, or release.

## Out Of Scope For Version 1

Do not include these yet:

- bends,
- overblows,
- overdraws,
- chords,
- vibrato-heavy performance takes,
- noisy-room stress tests.

Those are all worth testing later, but they add too many variables before the natural-note baseline is understood.

## Suggested Next Step After Recording

Once we have the WAV files, the next debugging flow should be:

1. run the detector on the raw files offline,
2. inspect raw detected frequency before note snapping,
3. inspect snapped harmonica note after vocabulary mapping,
4. compare pre-smoothing and post-smoothing outputs,
5. compare G results against C results.

That sequence keeps the investigation simple and makes it easier to locate the real failure point.
