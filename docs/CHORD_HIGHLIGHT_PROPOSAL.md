# Chord Highlight Proposal

## Background

The Scales workspace already shows blow and draw chords derived from adjacent
unbent holes.  The question is whether live audio detection can highlight the
chord the user is currently playing.

### What the offline data shows

Offline Goertzel analysis of real chord recordings (`scripts/detect-offline.ts`,
chord verification section) produced two consistent findings:

1. **The lowest note in a multi-hole chord is physically weak.** Hole 1 blow
   (C4) registered 0.01–0.04 relative power across two takes; hole 1 draw (D4)
   was similarly weak.  This appears to be a reed-physics issue: air splits
   across all open holes and lower reeds, which have more mass and need more
   back-pressure, barely vibrate.

2. **Note dominance within a chord shifts unpredictably between takes.**
   `8_draw-9_draw-10_draw` peaked at A6 in take 1 and at F6 in take 2;
   `1_blow–4_blow` peaked at G4 in take 1 and C5 in take 2.  The same chord
   played twice produces a different spectral fingerprint each time.

These two effects together make polyphonic detection (verifying all N notes are
simultaneously present above a threshold) unreliable for harmonica.  Adding
more takes or harmonicas is unlikely to change this — the variability comes from
embouchure and breath pressure, not from recording conditions.

---

## Proposed approach: dominant-note chord matching

Rather than trying to detect all notes in a chord, use what the existing
monophonic detector already does reliably — identify the single dominant
frequency — and ask: **is that note a member of any chord currently on screen?**

If it is, highlight that chord row.

### How it would work

1. The detector fires as it does today, producing a snapped MIDI note.
2. Each chord row in the Scales results is checked: does the detected note
   appear in this chord's note set?
3. Matching chord rows are highlighted; non-matching rows are dimmed.
4. When the detector goes silent, all rows return to neutral.

No new detection logic is needed — the monophonic detector output is the only
input.

### Ambiguity is expected and okay

Some notes appear in multiple chords.  G4 is in the blow chord for holes 2–3
and in the draw chord for holes 1–2.  Both rows would highlight simultaneously.
That is a feature, not a bug: it tells the user "these are the chords you could
be contributing to right now."  The user still has to know which holes they are
covering; the UI just narrows the candidates.

---

## Tradeoffs

**In favour**
- Uses the existing detector with no changes.
- Reliable — it's only as wrong as the monophonic detector already is.
- Consistent: the same note always highlights the same chords.

**Against**
- Does not confirm the *full* chord is being played — only that one note in it
  is dominant.  A user playing a single note will highlight the same chords as
  a user playing the full chord.
- Ambiguous matches (multiple chords lit) may confuse users who expect a single
  chord to be identified.
- The signal is softer than "you played this chord correctly," which limits its
  usefulness for anything score-like.

---

## What implementation would require

1. **Logic layer** — a helper that takes a MIDI note and a list of chord objects
   and returns which chords contain that note.  Chords are already computed; no
   new data model work needed.

2. **Scales results UI** — chord rows need a highlighted/dimmed visual state
   wired to the audio snapshot.  The audio store is already available in the
   Scales workspace.

3. **Subscription scope** — chord rows would subscribe to the same `stable`
   audio snapshot already used by the Scales listen display.  No new
   subscription path needed.

Roughly: one small logic helper, one style change to chord rows, and one
connection from the audio store to the chord list renderer.

---

## Open questions

- **Highlight style**: should a matching chord row glow/fill, or just have a
  coloured border?  Should non-matching rows dim, or stay neutral?  Dimming
  non-matches draws more attention to the match but could feel noisy when only
  one note is held.

- **Threshold for "detected"**: should chord highlighting only activate when
  confidence is above the current tone-follow minimum, or use a looser threshold
  since this is display-only and not driving cursor movement?

- **Arpeggio rows**: the same logic could highlight individual notes within an
  arpeggio row (the detected note highlights its cell).  That is more granular
  and possibly more useful for practice, but it is a separate UI change and can
  be deferred.

- **Is this worth the UI complexity?** If the softer signal ("a note in this
  chord is dominant") is not meaningfully helpful for practice, it may not be
  worth wiring up at all.  Worth deciding before building.
