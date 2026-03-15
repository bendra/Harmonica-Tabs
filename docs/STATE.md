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
- The Properties screen includes a transposer keyboard setting that lets the user choose `Custom Tab Pad` or `Native Keyboard`.
- Without an explicit user choice, the transposer still defaults from environment detection: native mobile uses the tab pad, touch-first web prefers the tab pad, and desktop-style web keeps normal typing.
- The custom tab pad opens from an intentional tap on the transposer input, not from generic focus events.
- Dismissing the tab pad via outside tap or `Done` also blurs the input so the pad stays closed instead of reopening immediately.
- On touch web, the transposer input uses a larger text size while the custom pad is active to avoid browser zoom-on-focus behavior.
- The tab pad inserts whole tab tokens (`sign + hole + suffix`) and includes paste, space, newline, backspace, and done actions.
- In custom-pad mode, clipboard paste is handled by the explicit `Paste` action rather than browser/OS long-press menus.
- Transposer input still accepts raw typing/paste, and a `Clean Input` action can strip non-tab content and normalize whitespace using Properties toggles.
- Properties screen is still separate via gear button.

## Tests
- `harmonica-tabs/tests/logic/tabs.test.ts`
  - C major output matches requirements.
  - `-2` vs `3` alt handling.
  - Overbend notation and exclusion rules.
- `harmonica-tabs/tests/logic/transposer.test.ts`
  - Token parsing (including `+` blow format) and whitespace preservation.
  - First-position transposition behavior for selected target key.
  - Warning behavior for unrecognized token fragments.
- `harmonica-tabs/tests/logic/transposer-input.test.ts`
  - Cleanup helpers for pasted mixed content.
  - Selection-aware insertion, full-token insertion, and backspace behavior for the transposer input.
- `harmonica-tabs/tests/logic/transposer-input-mode.test.ts`
  - Input-mode detection across native, touch-first web, tablet web, desktop web, and touchscreen desktop cases.
- `harmonica-tabs/tests/ui/navigation.test.tsx`
  - Pager state survives leaving and returning from the Properties screen.
  - The Properties screen exposes the transposer keyboard choice and can switch touch-first web back to the native keyboard.
  - The custom tab pad can be dismissed by outside tap or `Done` without immediately reopening.
  - Clipboard paste via the custom pad inserts sanitized text and reports clipboard-read failures without closing the pad.
