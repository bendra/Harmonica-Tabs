## HarpPilot v0.5 — Walkthrough Summary

### What the app is

HarpPilot is a practice and reference tool for 10-hole diatonic harmonica players. It has two main workspaces: **Scales**, which visualises which holes to play for a given scale and position on a given harp, and **Tabs**, which is a personal library of saved tabs with transposition and pitch-detection playback. A settings panel controls display preferences and pitch detection tuning.

---

### What's working well

**The position/key model is correct and musically honest.** Separating "Harmonica Key" (the physical harp in your hand) from "Target Position/Key" (the key you're playing in) is exactly how players think. Most tools collapse this and confuse people. The ⇄ swap button for flipping to a song-key-first workflow is a genuinely useful feature, and the documentation explains it well.

**The -2/3 preference setting is a gem.** The fact that the app knows -2 draw and 3 blow are the same pitch on a C harp, and lets you choose your preferred spelling, shows real instrument knowledge. This is the kind of detail that earns trust from experienced players.

**Scale and arpeggio reference is solid.** The scale list (Major, Major Pentatonic, Natural Minor, Minor Pentatonic, Harmonic Minor, Dorian, Mixolydian, Blues Minor) covers the vast majority of real-world harp use. The arpeggio expansion — showing all seven triads, 7th chords, or blues chords with the chord tones highlighted in the tab row above — is genuinely useful for understanding where chord tones sit on the harp.

**The tab library with transposition is practically valuable.** Storing songs and being able to instantly re-render them for a different position or harp is something players currently do on paper or in their heads. The octave-shift controls handle the cases where a transposed tab lands off the available holes.

**Pitch detection with tone-follow is ambitious and the right direction.** The three tunable parameters (Tolerance, Confidence, Note Separation) show the developer understands that pitch detection on harmonica is genuinely tricky — the instrument is quiet, bends are continuous, and repeated notes require articulation rather than re-attack.

**The documentation is honest and concise.** It doesn't pad or condescend, covers the non-obvious interactions, and includes practical tips.

---

### What could be better

**Scales view feels a bit sparse.** Outside of the tab row and arpeggio list, there's a lot of empty screen. The app doesn't currently show you what notes each hole plays (their letter names), which would help players cross-reference with sheet music or other instruments.

**The saved tab list is hard to scan.** Each entry shows raw tab notation as a preview, which is dense and unreadable at a glance. The list grows unwieldy quickly.

**The settings panel exposes a debug field to all users.** "Send Interval MS (DEBUG)" sits alongside user-facing settings without visual separation.

**The help requires navigating into Settings first.** It's not reachable from the main UI.

---

### Concrete suggestions

**1. Add 4th position to the Positions filter default (or change the default to "1st, 2nd, 3rd, 5th").** 4th position gives a natural minor scale and is genuinely used by folk and blues players. The "All" option exists, but burying 4th position there signals it's exotic when it isn't. At minimum, the default should be `1st, 2nd, 3rd, 5th` rather than the most restricted option.

**2. Show note names in the Scales tab row.** Under or above each hole chip, show the letter name of the note that hole plays in the current position/key (e.g. G, A, B under the relevant chips when in G Major). This bridges the gap between tab notation and musical thinking, and would make the arpeggios much easier to reason about.

**3. Replace the raw tab preview in the Tabs list with a summary line.** Instead of `4 6 -5 5 -4 4 3 6 7 -6 6...`, show something like `"Heart of Gold — 42 notes · C harp · 2nd pos · updated Apr 19"`. The raw notation provides no useful at-a-glance information.

**4. Add a small position description to the Target Position dropdown.** Currently it shows `1st / C`, `2nd / G`, `3rd / D`. Adding a one-word flavour label would help enormously for players learning positions: `1st / C — straight`, `2nd / G — blues`, `3rd / D — minor`, `4th / F — nat. minor`. Even just a tooltip on hover would do it.

**5. Hide or visually separate the DEBUG field in Properties.** Either move "Send Interval MS (DEBUG)" behind a collapsed "Advanced" section, or at least add a horizontal rule separating it from the user-facing Tone Follow settings. Its presence alongside normal settings implies it's something users should think about.

**6. Make Help accessible from the main screen.** Currently it requires going into the gear icon first. A small `?` or `Help` link in the main nav (perhaps next to the gear) would be more discoverable, especially for new users who don't yet know the settings panel exists.

**7. Add a "What harp do I need?" tip or callout on the main Scales screen.** The ⇄ swap feature is well documented but totally invisible unless you know to look. A subtle label like "Know your song key? Tap ⇄" near the button would surface it to users who would benefit most.

**8. Add a fourth Tip in the Help docs.** Something like: *"For minor key songs, try 2nd position with the Dorian scale — it's the most natural-sounding minor on a diatonic harp and requires fewer bends than Natural Minor."* This is the kind of practical cross-referencing between position and scale choice that would genuinely shape how someone uses the app.

**9. Clarify the harmonica type upfront.** Both in the app description and the help docs, it's worth adding one explicit sentence early: *"HarpPilot is designed for standard 10-hole Richter-tuned diatonic harmonica."* Players of chromatic, tremolo, or bass harps should know quickly that the tab layout won't apply to them.

**10. Consider a "favourite" or "pin" feature for the Tabs library.** As the library grows, being able to pin frequently used tabs to the top would be more useful than purely alphabetical ordering.
