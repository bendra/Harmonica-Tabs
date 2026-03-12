# Project State

## Structure
- `harmonica-tabs/App.tsx`: Main UI screen (pager + visualizer + transposer + properties screen).
- `harmonica-tabs/src/data/*`: Notes, keys, scales, Richter layout.
- `harmonica-tabs/src/logic/tabs.ts`: Core tab generation logic.
- `harmonica-tabs/src/logic/transposer.ts`: Tab text parsing and transposition logic.

## Key Decisions (Current)
- Standard 10‑hole Richter tuning only.
- Overbends excluded on holes 2, 3, and 8.
- Overbend notation selectable: `'` or `°`.
- Note spelling follows harmonica key (flats vs sharps).
- Tabs default to `-2` instead of `3` when they are the same pitch.
- Tabs are clickable to toggle alternates (currently only `-2` ↔ `3`).
- Chords shown separately for Blow and Draw based on adjacent unbent holes.

## UI Summary
- Main screen has a 2-page horizontal pager with pagination dots.
- Fixed controls above pager: Harmonica key + Target Position/Key.
- Pager page 1 (Visualizer): Scale Name + Arpeggios + listen/debug + generated tabs/arpeggios.
- Pager page 2 (Tab Transposer): multiline input, transposed output, and parser/transpose warnings.
- Tab transposer uses exact up/down transposition only; no automatic octave fallback.
- Properties screen is still separate via gear button.

## Tests
- `harmonica-tabs/src/logic/tabs.test.ts`
  - C major output matches requirements.
  - `-2` vs `3` alt handling.
  - Overbend notation and exclusion rules.
- `harmonica-tabs/src/logic/transposer.test.ts`
  - Token parsing (including `+` blow format) and whitespace preservation.
  - First-position transposition behavior for selected target key.
  - Warning behavior for unrecognized token fragments.
