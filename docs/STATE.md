# Project State

## Structure
- `harmonica-tabs/App.tsx`: Main UI screen (pager + visualizer + transposer + properties + saved-tab library screen).
- `harmonica-tabs/src/data/*`: Notes, keys, scales, Richter layout.
- `harmonica-tabs/src/logic/tabs.ts`: Core tab generation logic.
- `harmonica-tabs/src/logic/transposer.ts`: Tab text parsing and transposition logic.
- `harmonica-tabs/src/logic/transposer-follow.ts`: Pure transposer cursor-advance logic driven by detector snapshots.
- `harmonica-tabs/src/logic/app-storage.ts`: App-owned async string-storage wrapper.
- `harmonica-tabs/src/logic/saved-tab-library.ts`: Saved-tab record parsing, sorting, title helpers, and persistence service.

## Key Decisions (Current)
- Standard 10‑hole Richter tuning only.
- Overbends excluded on holes 2, 3, and 8.
- Overbend notation selectable: `'` or `°`.
- Note spelling follows harmonica key (flats vs sharps).
- Tabs default to `-2` instead of `3` when they are the same pitch.
- Tabs are clickable to toggle alternates (currently only `-2` ↔ `3`).
- Chords shown separately for Blow and Draw based on adjacent unbent holes.
- Tone follow is token-based in the transposer: only successfully transposed output tab tokens are followable/clickable.
- Tone follow reuses the shared listen session; web microphone input is still the only real detector today.
- Tone follow is automatically on while listening is on, and off while listening is off.
- Repeated identical output notes require a release before the cursor can advance again.
- Saved tabs persist only `inputText` plus library metadata (`id`, `title`, `createdAt`, `updatedAt`).
- Loading a saved tab updates only the transposer input; it does not change direction, harmonica key, target position/key, or derived output.
- Editing a loaded saved tab keeps it linked to that saved record until the user deletes it; saving again overwrites that same record.
- `Save As` always creates a new saved record, even when the editor is currently linked to an existing saved tab.
- `New` creates a blank draft by clearing the active saved-tab link and the current editor text.
- Deleting the currently loaded saved tab removes it from the library but keeps the current editor text on screen as an unsaved draft.

## UI Summary
- Main screen has a 2-page horizontal pager with pagination dots.
- Fixed controls above pager: Harmonica key + Target Position/Key.
- Pager page 1 (Visualizer): Scale Name + Arpeggios + listen/debug + generated tabs/arpeggios.
- Pager page 2 (Tab Transposer): multiline input, shared listen control, clickable transposed output, and parser/transpose warnings.
- The transposer now includes `New`, `Save` / `Re-save`, `Save As`, and `Library` actions for a local saved-tab library.
- Tab transposer uses exact up/down transposition only; no automatic octave fallback.
- Transposer output now preserves render segments while also tracking playable output tokens with MIDI metadata for tone follow.
- The transposer output auto-scrolls just enough to keep the active token visible during tone follow and manual cursor moves.
- Saved tabs open in a dedicated Library screen with load/delete actions and dirty-state protection before replacing unsaved editor text.
- Starting a new draft with unsaved changes offers `Cancel`, `Discard and New`, and `Save Then New`.
- The Properties screen includes a transposer keyboard setting that lets the user choose `Custom Tab Pad` or `Native Keyboard`.
- The Properties screen also includes tone-follow settings for tolerance, minimum confidence, and hold duration.
- The transposer now defaults to `Native Keyboard` unless the user explicitly switches to `Custom Tab Pad`.
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
- `harmonica-tabs/tests/logic/transposer-follow.test.ts`
  - Hold/confidence/tolerance advancement rules.
  - Re-arm behavior for repeated identical notes.
  - Manual cursor resets via state replacement.
- `harmonica-tabs/tests/logic/transposer-input.test.ts`
  - Cleanup helpers for pasted mixed content.
  - Selection-aware insertion, full-token insertion, and backspace behavior for the transposer input.
- `harmonica-tabs/tests/logic/transposer-input-mode.test.ts`
  - Input-mode detection across native, touch-first web, tablet web, desktop web, and touchscreen desktop cases.
- `harmonica-tabs/tests/logic/saved-tab-library.test.ts`
  - Title defaults, malformed-data fallback, save/update behavior, and sort order for persisted saved tabs.
- `harmonica-tabs/tests/ui/navigation.test.tsx`
  - Pager state survives leaving and returning from the Properties screen.
  - The Properties screen exposes the transposer keyboard choice and can switch touch-first web back to the native keyboard.
  - The transposer exposes a shared listen control and clickable output tokens.
  - The transposer cursor resets when output changes, auto-scrolls to keep the active token visible, and the shared listen button works from the transposer page.
  - The custom tab pad can be dismissed by outside tap or `Done` without immediately reopening.
  - Clipboard paste via the custom pad inserts sanitized text and reports clipboard-read failures without closing the pad.
  - Saving, loading, re-saving, save-as branching, new-draft prompts, deleting, and dirty-load confirmation all work for the saved-tab library.
