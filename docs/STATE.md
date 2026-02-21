# Project State

## Structure
- `harmonica-tabs/App.tsx`: Main UI screen (controls + tabs + chords).
- `harmonica-tabs/src/data/*`: Notes, keys, scales, Richter layout.
- `harmonica-tabs/src/logic/tabs.ts`: Core tab generation logic.

## Key Decisions (Current)
- Standard 10‑hole Richter tuning only.
- Overbends excluded on holes 2, 3, and 8.
- Overbend notation selectable: `'` or `°`.
- Note spelling follows harmonica key (flats vs sharps).
- Tabs default to `-2` instead of `3` when they are the same pitch.
- Tabs are clickable to toggle alternates (currently only `-2` ↔ `3`).
- Chords shown separately for Blow and Draw based on adjacent unbent holes.

## UI Summary
- Top row: Harmonica key dropdown + overbend notation dropdown.
- Scale selection: Scale key dropdown + scale name dropdown + Add.
- Selected tabs list: per scale with tab chips, removable.
- Chords row per scale: Blow and Draw, inline.

## Tests
- `harmonica-tabs/src/logic/tabs.test.ts`
  - C major output matches requirements.
  - `-2` vs `3` alt handling.
  - Overbend notation and exclusion rules.
