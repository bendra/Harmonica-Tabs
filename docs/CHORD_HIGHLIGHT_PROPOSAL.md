# Chord Highlight Proposal

## What currently exists

The Scales workspace shows scale and arpeggio notes as individual tab chips
(e.g. `4`, `-4`, `5`).  When listening, a floating caret moves underneath the
chip whose MIDI note best matches the currently-detected frequency.  This is
monophonic: one note detected, one chip indicated at a time.

`detectChord()` already exists in `src/logic/fft-detector.ts` but is not wired
to the UI.  It runs Goertzel at every harmonica note frequency and returns the
set of notes whose power clears a relative threshold — but with no structural
constraints, so the returned set is inconsistent (see offline data below).

## The key harmonica constraint

On a harmonica you can only blow or draw at any moment — never both — and chords
are always played on adjacent holes.  This means the universe of valid chords is
small and fully enumerable:

- All contiguous groups of 2+ holes, all-blow or all-draw
- For a 10-hole harmonica, groups of size 2–4 give roughly 48 candidates total
  (24 per direction); size 5+ can be included but are rare in practice

This reduces the detection problem from "which individual notes are
independently active?" to "which candidate group best matches the current
spectrum?" — a much tighter question with a definitive answer.

## Proposed detection strategy

For each audio frame while listening:

1. Compute Goertzel power at every candidate group's member frequencies.
2. Score each group by the **mean power** of its members, normalized to the
   strongest single note in the frame.  Mean is more robust than minimum (which
   would be hurt by a weak low note) and more honest than sum (which grows with
   group size).
3. The highest-scoring group above a minimum threshold is the detected chord.
   Below the threshold: no chord detected (silence or single note).
4. The detected group's member MIDI notes are used to highlight the
   corresponding chips in the Scales display.

This sidesteps the "weak lowest note" problem observed in offline data: if
holes 2–4 blow are strong but hole 1 blow is weak, the group `2-4 blow` scores
well even though `1-4 blow` scores poorly.

## What the offline data says

Goertzel analysis of real C-harmonica chord recordings showed:

1. **Lowest note in a chord is physically near-silent** (hole 1 blow: 0.01–0.04
   relative power across two takes).  Group scoring handles this — the detector
   would simply prefer the sub-group that excludes the weak note.

2. **Note dominance shifts between takes**, meaning the highest-scoring *group*
   may not always match exactly what was played.  However, group scoring is
   substantially more stable than per-note thresholding because the aggregate
   smooths over per-note variation.

The approach won't be perfect but should be significantly more consistent than
the existing unconstrained `detectChord`.

## What implementation would require

1. **New detection function** — `detectAdjacentChord(input, sampleRate,
   vocabulary)` that enumerates candidate groups, scores each, and returns the
   best match (or null if below threshold).  The existing `goertzelPower`
   helper in `fft-detector.ts` can be reused directly.

2. **Audio pipeline** — run the new function alongside (or instead of)
   `detectSingleNote` and expose the result through the audio store / listening
   snapshot.

3. **Scales results UI** — each tab chip checks whether its MIDI is in the
   detected group's note set; if so, it renders highlighted.  The floating
   caret could be removed or kept as a single-note fallback.

4. **Arpeggio rows** — same chip-level check, replacing the existing
   `rowMatch` / `rowCaretPos` caret logic.

## Open questions

- **Group size range**: should size-2 groups be included (very common in
  practice) or excluded as too ambiguous?  A size-2 match will be a subset of
  many larger groups.
- **Scoring function**: mean power is the suggested starting point but may need
  tuning once tested against live recordings of different chord sizes.
- **Threshold**: what minimum mean-power score constitutes "a chord is being
  played" vs. "one note with a strong harmonic"?  This will need empirical
  tuning, ideally against the existing chord sample set.
- **Single notes**: should single-note playing be treated as a size-1 "chord"
  and handled by this same path, or kept as a separate monophonic detection
  path?
- **Caret vs. highlighting**: remove the floating caret entirely and rely on
  chip highlighting, or keep both?
