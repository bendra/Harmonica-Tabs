# HarpPilot User Guide

HarpPilot helps you visualize playable scales and chords on a standard 10‑hole diatonic (Richter) harmonica, transpose tabs between keys, and play along while the app listens through your microphone.

This guide explains everything you need to use the app day‑to‑day. The same content is available inside the app from the **?** button in the main header or from the **Properties** screen via **Help**.

---

## Quick orientation

The app has two main workspaces, switched via the **Scales / Tabs** buttons at the bottom of the screen:

- **Scales** — pick a harmonica key, a target key/position, and a scale name; HarpPilot shows you the playable tabs and (optionally) related arpeggios.
- **Tabs** — manage a personal library of saved tabs, edit tab text, and play tabs back with octave‑shift controls and tone‑follow.

A **?** button in the top right opens this guide. The **gear icon** next to it opens **Properties**, where you adjust display preferences and detection settings.

---

## Reading tabs (symbol reference)

Tabs describe which hole to play and how. Numbers refer to hole positions on a 10‑hole diatonic harmonica.

| Symbol | Meaning |
|---|---|
| `4` | Blow on hole 4. |
| `-4` | Draw on hole 4. |
| `-4'` | Draw bend, one semitone. |
| `-3''` | Draw bend, two semitones (deeper bend). |
| `4°` / `-7°` | Overbend, when **Overbend Symbol** is set to `°`. |
| `4'` / `-7'` | Overbend, when **Overbend Symbol** is set to `'`. |

Notes about notation HarpPilot uses:

- **Blow** is written as the bare hole number (`4`).
- **Draw** is written with a leading minus (`-4`).
- **Bends** stack apostrophes — one `'` per semitone of bend.
- **Overbends** (overblows on holes 1–6, overdraws on holes 7–10) use either `°` or `'`, your choice. The same tab will render differently depending on this setting.
- **Excluded overbends:** HarpPilot does not suggest overbends on holes **2, 3, or 8**, because the same notes are easier to reach elsewhere.
- **Alternate fingerings:** sometimes two tabs play the same pitch (most commonly `-2` and `3` on a C harp, which are both G). The tab is shown as one chip; tapping it cycles to the alternate.

---

## Scales workspace

This is the fastest way to answer "what tabs do I need to play this scale on this harp?"

**Controls (top of the screen):**

- **Harmonica Key** — the key of the physical harp in your hand (for example, `C`).
- **Target Position/Key** — the key you want to play *in*, expressed as a position relative to the harp.
  - 1st position = the harp's own key (e.g., C on a C harp).
  - 2nd position = a fifth above (e.g., G on a C harp — the classic blues position).
  - 3rd position = a step above (e.g., D on a C harp).
  - And so on. The dropdown shows both the position number and the resulting key, e.g., `2nd / G`.
- **Scale Name** — Major, Natural Minor, Major Pentatonic, Minor Pentatonic, Harmonic Minor, Dorian, Mixolydian, or Blues Minor.
- **Arpeggios** — optionally show triads, 7th chords, or common blues chords built on the selected scale's root.

**Results:**

- The main result row shows the scale's notes laid out left‑to‑right as playable tabs.
- If you turn on **Arpeggios**, additional rows appear below labeled with Roman numerals (`I maj`, `ii min`, etc.).

**Listening (mic input):**

- Tap **Listen** to start mic detection. While listening, a caret moves between adjacent tabs to show the pitch you're playing.
- The caret only moves if HarpPilot is confident in the detected note. You can tune confidence and tolerance in **Properties** (see below).
- If your device doesn't grant mic access or doesn't support real‑time audio, HarpPilot falls back to a simulated input so you can still see how the UI behaves.

---

## Choosing a harmonica for a song's key

The default top‑row workflow assumes you start with a harp in your hand and want to know what key it plays in. Sometimes you have the opposite problem: a song is in a particular key and you don't yet know which harmonica to grab. The small **⇄** button on the right edge of the top row flips the two dropdowns to support that case.

- Tap **⇄** once to enter target‑key‑first mode. The first dropdown becomes **Target Key** (all 12 keys, not narrowed by your Positions filter) and the second becomes **Harmonica + Position**.
- The Harmonica + Position list is ordered **practical first**: 1st, 2nd, 3rd, and 5th positions appear at the top (they cover most playing styles — major, blues, minor‑blues, natural minor), followed by 4th and the rest.
- Pick from **Target Key** to keep your current harp and adjust the position to match the new key. Pick from **Harmonica + Position** to switch the harp (and its position) to play the current target key.
- If the chosen position isn't visible in your current **Positions** filter (see Properties), HarpPilot automatically expands the filter to **All** so the new selection is reachable.
- Tap **⇄** again to return to the default harmonica‑first view.

The same swap toggle is available in **Tabs → Transpose**, with the same behavior.

---

## Tabs workspace

The Tabs workspace is for saving, organizing, and playing along with your own tabs. It has two views:

### Library

Where your saved tabs live.

- **New Tab** opens the editor with a blank draft.
- Each saved tab row shows the title, a short preview, the harp/position context (if you saved one), and the last‑updated time.
- Row actions:
  - **Open** — load the tab into the Transposer view. If the tab was saved with a harp/position that doesn't match your current selection, HarpPilot prompts you with three options (see *Saved context* below).
  - **Edit** — open the editor on that saved tab.
  - **Delete** — remove the saved tab. If the deleted tab is currently open in the editor, the text stays as an unsaved draft.

The library list is sorted alphabetically by title.

### Transposer

Plays a saved tab back, optionally transposed.

- **Choose Tab** clears the current source and returns to the library so you can pick a different tab.
- **Edit Tab** opens the current source in the editor.
- **Down / Up** step the displayed tab by one octave at a time. Buttons disable when the next octave would put any note out of range.
- **Base** resets to the saved tab in first position and also resets the **Target Position/Key** picker back to first position on the current harp.
- The transposed tab is shown in a scrollable box. Tabs that successfully transpose are clickable to move the play cursor manually.
- **Warnings** appear below the tab box if any tokens couldn't be transposed (for example, a note that doesn't exist on the current harp).

**Tone follow** is automatically on while listening is on. As you play, the cursor advances through the tab, wrapping back to the first playable note when you finish. Repeated identical notes require a brief release (a pitch change or volume dip) before the cursor advances again.

### Editor

A full‑screen overlay you reach via **New Tab**, **Edit Tab**, or row **Edit** actions.

- **Title** — set the tab's name (auto‑suggested from content when blank).
- **Tab content** — paste or type tab text. The platform keyboard is used; there's no custom on‑screen tab pad.
- **Clean Input** — strips non‑tab characters and normalizes whitespace.
- **Save with key/position context** — when on, the saved tab remembers a specific harp + position. The selectors above the checkbox enable when you turn this on.
- **Save** — overwrite the current saved record (or create one for a new draft).
- **Save As** — always create a new saved record without overwriting the original.
- **Cancel** — close the editor; if you have unsaved changes, HarpPilot asks before discarding them.

### Saved context

When you open a saved tab whose stored harp/position doesn't match your current selection, HarpPilot offers three options:

1. **Use the saved harp + position** — switches both selectors to match the saved record.
2. **Keep current harp, switch position to preserve the saved target key** — useful if you've changed harps but want to hear the same song.
3. **Keep current selection** — just loads the tab without changing anything.

### Importing tabs from HarpTabs.com

HarpTabs.com is a large community library of harmonica tabs. Most tabs there are key‑agnostic: the numbers describe a shape on any 10‑hole diatonic harp, and the harp key you choose determines the sounding key.

To copy a tab into HarpPilot:

- Find the song on HarpTabs.com and choose a diatonic tab. Tabs marked `§` are diatonic.
- Copy just the tab body — usually the lines of numbers and lyrics. Skip the song header, ratings, key, difficulty, and footnotes when you can.
- In HarpPilot, go to **Tabs → Library**, tap **New Tab**, add a title, and paste the copied text into the editor.
- Tap **Clean Input** to strip non‑tab content and normalize spacing, then tap **Save**.

The saved tab can now be opened in the Transposer. If you did not save key/position context, HarpPilot treats the source as a neutral tab shape: the numbers mean the same thing on any harp.

To play it:

- Pick up the harp that fits the song key or the band you are playing with.
- In the Transposer top row, set **Harmonica Key** to that harp and **Target Position/Key** to the position you want. 1st position plays in the harp's own key; 2nd position plays a fifth above, the classic blues cross‑harp sound.
- Use **Down / Up** if the melody sits too high or low on your harp.

Tip: many shared tabs are written with a C harp in mind. If the tab feels natural as written, leave it in 1st position and simply set **Harmonica Key** to the harp in your hand.

---

## Properties

Open the gear icon in the top right.

- **Overbend Symbol** — `°` or `'`. Affects how overbends are rendered everywhere in the app.
- **Positions** — which positions show in the Target Position/Key dropdown.
- **Harmonica Keys** — display preference for harp key labels (standard / flat / sharp).
- **Target Keys** — display preference for target/scale note labels (flat / sharp).
- **2 Draw / 3 Blow Preference** — which tab to show first when both fingerings produce the same pitch. A help icon explains in detail.
- **Tone Tolerance** — how close to in‑tune (in cents) counts as "this note" for the caret and tone‑follow. Default is ±10 cents.
- **Minimum Confidence** — how confident the detector must be before a note is accepted. Lower values are more permissive but noisier.
- **Note Separation** — how much release/articulation is needed between two identical notes before the tone‑follow cursor will advance again.
- **Debug** — toggles a status panel with raw detector frame data. Useful only when troubleshooting.
- **Help** — opens this user guide.

There is also a temporary **Native send interval ms (debug)** field used while tuning the native fallback audio path; you can leave it at its default.

---

## Tips & best practices

- If you only play one harp regularly, leaving it as your **Harmonica Key** and changing only **Target Position/Key** is the fastest workflow for jamming in different keys.
- **Major Pentatonic** and **Minor Pentatonic** are great starting points for soloing — they have no bends in most positions, so the tabs are simpler.
- Use the **Library** to save tabs you've worked out so they're one tap away later. Save with key/position context turned on if the tab only makes sense on a specific harp.
- If pitch detection feels jumpy, raise **Minimum Confidence** in Properties. If it feels unresponsive, lower it.
- If you keep playing a note but the cursor isn't advancing, try a slightly more articulated attack between repeated notes — or raise **Note Separation**.

---

## Troubleshooting

- **"No mic input" / nothing happens when I tap Listen** — make sure the app has microphone permission in your OS settings. On web, you may need to use `https://` or `localhost` for the browser to allow mic access.
- **The wrong note is being detected** — try a quieter environment, raise **Minimum Confidence**, or lower **Tone Tolerance** to require closer‑to‑pitch playing.
- **Saved tabs disappeared after reinstalling** — HarpPilot stores saved tabs locally per device; there is no cloud sync yet. Back up by exporting (when that feature ships) or by copying tab text manually.
