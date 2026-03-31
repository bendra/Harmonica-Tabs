# UI Suggestions

Date: 2026-03-28
Based on: mobile and tablet screenshots, docs/UI_MAP.md, docs/ARCHITECTURE.md

---

## Scales Workspace

### Listen Card — label and status

The **Listen Button** label ("Listen & Highlight Notes [OFF]") is doing too much work. The `[OFF]`/`[ON]` state tag is easy to miss in-line with the label text, even though the button border turns teal when active. Suggested direction: shorten the label (e.g. "Listen") and rely on visual treatment (border/fill) for on/off state. Move the detected-note status (`-3 • 492.4 Hz -5¢`) out of the button row into a dedicated **Listen Row** status line below the button, where it has room to breathe and is clearly distinct from the toggle action.

### Listen Card — empty state

When listening is off, "Off" floats to the right of the button in a large empty card. On tablet especially, this whitespace reads as unfinished. Options: display a short prompt ("Tap to start pitch detection"), or collapse the right side of the Listen Row entirely when not listening.

### Results Scroll Area — empty space below results

On both mobile and tablet, when only one scale is shown with no arpeggios selected, there is a large blank area below the **Result Card**. This is most pronounced on tablet where it occupies roughly two-thirds of the screen. A short empty-state hint — "Select an arpeggio type above to see chord tabs" — placed directly in the **Results Scroll Area** would fill this purposefully and guide new users.

### Arpeggio Section — tap targets

The checkboxes (☑/☐) next to arpeggio rows (e.g. "I7 · G–B–D–F") are small and close to the label text. On mobile especially these are difficult to tap precisely. A taller row with the checkbox shifted to the trailing edge (right side) would give a more standard affordance and a larger hit area.

### Tab chip color coding

The current color scheme distinguishes root notes (gold/amber) from non-root notes (white/grey). However, draw bends (`-3''`), overblows (`6°`), and plain draw notes (`-3`) are distinguished only by their notation characters — there is no color or weight difference. Given that recognising technique at a glance is core to the app's purpose (especially during live pitch detection), a subtle additional color or weight for bend/overbend chips would help users parse the **Main Tab Row** faster. One option: dim the overbend chips slightly relative to bends, and bends relative to plain notes, reinforcing the technique hierarchy already encoded in the ordering logic.

### Tab Symbols Help — discoverability

The **Tab Symbols Help** button is on the Properties Screen, which a first-time user is unlikely to find before being confused by `-3''` or `6°`. A small `?` icon or link near the **Main Tab Row** on the Scales workspace — linking directly to the Tab Symbols Screen — would surface the reference where it is actually needed.

---

## Tablet Layout — Scales Workspace

### Single-column layout wastes screen space significantly

On tablet, the **Scales Workspace** stays single-column and stretches all controls edge to edge (~1200px). The **Harmonica Key** and **Target Position/Key** dropdowns each span roughly 600px for a single short value ("C", "1st / C"). The **Scale Name** dropdown similarly. The **Result Card** shows a single row of tab chips that looks good horizontally, but the remaining ~60% of the screen below it is empty.

The architecture docs note that a two-column tablet layout has been deferred pending user testing of the size tiers. Based on the screenshots, this is the most impactful layout improvement available. A straightforward split would put the controls (Top Row, Header Controls, Listen Card) in a fixed left column and the **Results Scroll Area** in a right column. This would eliminate the dead space, keep controls visible while scrolling results, and give arpeggio content room to expand naturally.

If a full two-column layout feels premature, an incremental improvement would be to cap the width of the **Top Row** dropdowns (e.g. max-width ~280px each) so they don't expand absurdly on wide screens, even before the layout split is addressed.

### Listen Card on tablet

On tablet, the **Listen Button** sits left-aligned and the "Off" status text is far to the right with a large gap. This is more pronounced than on mobile. The suggestion above (moving status into a dedicated line below the button) would also resolve this layout issue.

---

## Tabs Workspace — Transpose View

### Transposer Output Box — active token highlight

The active token is indicated by a teal ring (`transposerOutputTokenActive`). On a dense tab like "Donna" with many tokens per line, this ring is subtle and easy to lose, particularly on mobile where the font is smaller. A filled background highlight (e.g. the same teal at ~25% opacity behind the token chip) would be more visible without being distracting.

### Transposer Output Box — tablet layout

On tablet, the **Transposed Tab Box** fills the full workspace width and is arguably the best-laid-out element on the tablet views — the monospace output is readable and lyrics (in red) are visually distinct from tab tokens. No major issue here, though the large empty space below the content when a short tab is loaded is noticeable.

### Current Source Label

"Current tab: Donna" (`transposerCurrentTab`) is small grey text below the **Source Actions** row. Since it is the primary context for everything on the Transpose View, it deserves slightly more presence — at minimum bolding the tab title, or moving it to the header area alongside "HarpPilot" when a tab is active.

### Octave Shift Controls — "Base" label

In the **Octave Shift Controls**, "Base" reads as a peer of "Down" and "Up" rather than as a reset action. Users may not intuit that it returns to the original saved tab in first position and resets the target picker. "Reset" or "Original" would communicate this more clearly. Alternatively, a short tooltip or subtext (e.g. "Base · resets to saved") would help without requiring a redesign.

### Scale Name not shown in Transpose View

On the Transpose View, the **Fixed Top Row** shows Harmonica Key and Target Position/Key, but there is no Scale Name selector. This is consistent with the transposer's purpose (it works from a saved source tab, not a scale), but it may confuse users who expect the Scales and Tabs workspaces to be more symmetric. At minimum, the Properties Screen could clarify what the Target Position/Key controls on each screen.

---

## Tabs Workspace — Library View

### Saved Tab Rows — preview truncation

The **Saved Tab Preview** (`savedTabPreview`) shows raw `inputText` as a single truncated line, which mixes tab tokens and lyric text without distinction. On tablet the row is wide enough to show a lot of content, but on mobile the truncation is aggressive. If the preview always showed only the tab tokens (not lyrics) it would be more scannable and useful for identifying the right song.

### Library View — empty state

The empty library state ("No saved tabs yet. Use New Tab to create one in the editor.") is clear and functional. However, the **New Tab Button** (`libraryNewButton`) appears above this message, which means a user's eye hits the button before reading the explanation. Reversing the order — explanation first, button below — is a more natural reading flow.

### Delete button visual weight

The **Delete** action button in **Row Actions** (`savedTabActionButton`) is styled with a red background, giving it significantly more visual weight than the **Open** and **Edit** buttons. On the tablet screenshot this is especially noticeable — Delete is the most prominent element in each row despite being a destructive action that should be de-emphasised. Consider making Delete a text-only button or an outlined button in a muted red, consistent with how destructive actions are typically styled.

---

## Properties Screen

### Layout — wasted space and hierarchy

The **Properties Card** has substantial empty space below the Tone Follow fields on both mobile and tablet. The **Debug Toggle** and **Tab Symbols Help** button sit in the middle of the card with no clear grouping. Suggested structure:

- **Display** section: Overbend Symbol, Positions, -2/3 Preference (already grouped implicitly)
- **Tone Follow** section: Tolerance, Confidence, Hold MS (already labeled)
- **Developer / Advanced** collapsed section: Debug Toggle
- **Help** section: Tab Symbols Help (or move this out to the main UI as discussed above)

### Tone Follow fields — advanced settings placement

The Tolerance, Confidence, and Hold MS fields are numeric inputs that most users will never need to adjust. They live on the main Properties screen alongside display preferences that are genuinely user-facing. Moving them into a collapsible **Advanced** section would reduce first-impression complexity without removing the controls.

---

## Header / Navigation

### Inconsistent header across screens

The **Header Row** shows "HarpPilot" on the Scales workspace and on the Library View, but on the Transpose View the workspace content starts immediately and there is no screen-level title in the header. The **Editor Overlay** shows "Tab Editor" as a title, which is correct. A consistent approach — either always showing the workspace name in the header or always relying on the **Workspace Switcher** for orientation — would help users know where they are.

### Gear button absent from Editor Overlay

The **Screen Toggle Button** (gear icon) is available on the Scales and Tabs main screens but is absent from the **Editor Overlay**. A user who wants to change the overbend notation while mid-edit cannot do so without cancelling out of the editor. Either adding the gear icon to the Editor Overlay header, or making the overbend preference accessible inline (unlikely given screen space), would close this gap.

---

## Cross-cutting

### Harmonica Key and Target Position/Key repeated across workspaces

The **Top Row** (Harmonica Key + Target Position/Key) appears on both the Scales workspace and the Transpose View of the Tabs workspace. Changes on one are reflected on the other, which is intentional. However, users who switch between workspaces may not immediately realise these are shared controls — they may assume the Tabs workspace has its own independent key context. A brief label or tooltip clarifying "shared with Scales" could prevent confusion, especially for the Target Position/Key picker on the Transpose View where it also drives the `Base` reset behavior.

### No visual indication of technique type beyond notation characters

Across all tab displays — **Main Tab Row**, **Arpeggio Tab Chips** (`arpeggioTabChip`), and **Transposed Tab Box** — technique type is encoded only in notation characters (`-`, `'`, `°`). For users still learning the notation, and especially during live pitch feedback when reading speed matters, an additional visual layer (color, weight, or icon) would lower the reading barrier. This is the single highest-impact visual improvement available short of a layout overhaul.

---

## Best Bang-for-Buck Ranking

Ranked by likely user impact relative to implementation effort, with simpler and safer changes favored over larger layout work.

1. **Listen Card — label and status**: clarifies a core interaction, reduces visual noise, and should be a modest wording/layout tweak.
2. **Arpeggio Section — tap targets**: strong usability win on mobile with relatively low implementation risk.
3. **Delete button visual weight**: small styling change that improves safety and visual hierarchy immediately.
4. **Current Source Label**: low-effort improvement that makes the Transpose view easier to orient within.
5. **Octave Shift Controls — "Base" label**: very cheap wording fix for a real comprehension problem.
6. **Transposer Output Box — active token highlight**: likely a contained visual tweak with clear benefit during tone-follow use.
7. **Tab Symbols Help — discoverability**: helpful for beginners, though it adds a new link or affordance near already-dense tab UI.
8. **Listen Card — empty state**: worthwhile polish, especially on tablet, but slightly less important than the main listen-label/status cleanup.
9. **Properties Screen — Tone Follow fields in Advanced**: improves first-impression simplicity, but requires a little more UI restructuring.
10. **Saved Tab Rows — preview truncation**: useful improvement for library scanning, though it may require preview-generation logic rather than pure styling.
11. **No visual indication of technique type beyond notation characters**: potentially very high impact, but should be explored carefully so it does not conflict with existing root-note and active-state emphasis.
12. **Tablet Layout — Scales Workspace two-column / width caps**: probably the biggest layout payoff on large screens, but it is the largest and riskiest change in this document, so it should come after the smaller wins above.
