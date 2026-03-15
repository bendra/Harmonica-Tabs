# UI Map

This document provides standard names for the app’s UI sections, based on the style keys in `harmonica-tabs/App.tsx`.

## High‑Level Layout (Top → Bottom)

```
SafeAreaView (styles.safeArea)
└─ ScrollView (styles.container)
   ├─ Header Row (styles.headerRow)
   │  ├─ Screen Title (styles.title)
   │  └─ Screen Toggle Button (styles.gearButton + styles.gearButtonText)
   └─ Screen Body (conditional)
      ├─ Main Screen (`screen === 'main'`)
      │  ├─ Fixed Top Row
      │  │  └─ Container (styles.topRow)
      │  │     ├─ Harmonica Key (styles.topRowKey + styles.dropdown*)
      │  │     └─ Target Position/Key (styles.topRowKey + styles.dropdown*)
      │  ├─ Pager Shell (styles.pagerShell)
      │  │  ├─ Horizontal Pager (ScrollView, pagingEnabled)
      │  │  │  ├─ Page 1: Visualizer (styles.pagerPage)
      │  │  │  │  ├─ Header Controls (styles.pageOneHeader)
      │  │  │  │  │  ├─ Scale Name (styles.scalePickerColumn + styles.dropdown*)
      │  │  │  │  │  └─ Arpeggios (styles.topRowToggle + styles.toggleGroup/toggleRow)
      │  │  │  │  ├─ Listen Card (styles.listenCard)
      │  │  │  │  │  ├─ Listen Row (styles.listenRow)
      │  │  │  │  │  └─ Debug Panel (styles.debugPanel, conditional)
      │  │  │  │  └─ Results List (styles.resultsList)
      │  │  │  │     └─ Result Card (styles.resultRow)
      │  │  │  │        ├─ Main Tab Row (styles.tabGroupList)
      │  │  │  │        └─ Arpeggio Section (styles.arpeggioSection, conditional)
      │  │  │  └─ Page 2: Tab Transposer (styles.pagerPage)
      │  │  │     └─ Transposer Card (styles.transposerCard)
      │  │  │        ├─ Tone Follow Controls (styles.transposerFollowControls)
      │  │  │        │  └─ Shared Listen Button (styles.listenButton)
      │  │  │        ├─ Tone Follow Status (styles.transposerFollowStatus)
      │  │  │        ├─ Input (styles.transposerInput)
      │  │  │        ├─ Mobile Pad Hint (styles.transposerPadHint, conditional)
      │  │  │        ├─ Paste Status (styles.transposerPadStatus, conditional)
      │  │  │        ├─ Direction Radio + Clean Input (styles.transposerDirectionRow + styles.transposerDirectionOption + styles.transposerActionButton)
      │  │  │        ├─ Output Box (styles.transposerOutputBox + styles.transposerOutputText)
      │  │  │        │  └─ Clickable Output Tokens (styles.transposerOutputToken + active/matched variants)
      │  │  │        │     └─ Auto-scroll keeps active token visible
      │  │  │        └─ Warnings (styles.transposerWarnings + styles.transposerWarningText)
      │  │  └─ Pager Dots (styles.pagerDotsRow + styles.pagerDot)
      │  └─ Tab Pad Modal (native + touch-first web, conditional)
      │     └─ Bottom Sheet (styles.transposerPadSheet)
      │        ├─ Handle (styles.transposerPadHandle)
      │        ├─ Title + Preview (styles.transposerPadTitle + styles.transposerPadPreview)
      │        ├─ Airflow Options (styles.transposerPadOptionRow + styles.transposerPadOptionButton)
      │        ├─ Suffix Options (styles.transposerPadOptionRow + styles.transposerPadOptionButton)
      │        ├─ Hole Grid (styles.transposerPadHoleGrid + styles.transposerPadHoleButton)
      │        └─ Action Row (styles.transposerPadActionRow + styles.transposerPadActionButton)
      │           └─ Includes `Paste`, `Space`, `New line`, `Backspace`, `Done`
      └─ Properties Screen (`screen === 'properties'`)
         └─ Properties Card (styles.propertiesCard)
            ├─ Section Title (styles.propertiesTitle)
            ├─ Overbend Symbol Select (styles.propertiesField + styles.dropdown*)
            ├─ Position/Key Set Select (styles.propertiesField + styles.dropdown*)
            ├─ 2 Draw / 3 Blow Preference Select (styles.propertiesField + styles.dropdown*)
            ├─ Transposer Keyboard Buttons (styles.propertiesChoiceRow + styles.propertiesChoiceButton)
            ├─ Strip Invalid Content Toggle (styles.propertiesToggleButton + styles.propertiesToggleText)
            ├─ Remove Excess White Space Toggle (styles.propertiesToggleButton + styles.propertiesToggleText)
            ├─ Tone Tolerance Select (styles.propertiesField + styles.dropdown*)
            ├─ Minimum Confidence Select (styles.propertiesField + styles.dropdown*)
            ├─ Hold Duration Select (styles.propertiesField + styles.dropdown*)
            ├─ Debug Toggle Button (styles.propertiesRow + styles.debugToggle)
            └─ Tab Symbols Help Button (styles.propertiesRow + styles.debugToggle)
      └─ Tab Symbols Screen (`screen === 'tab-symbols'`)
         └─ Symbols Card (styles.propertiesCard)
            ├─ Section Title (styles.propertiesTitle)
            └─ Symbol Rows (styles.symbolRow + styles.symbolKey + styles.symbolMeaning)
```

## Naming Reference

- **Header / Screen Nav**: `headerRow`, `title`, `gearButton`, `gearButtonText`
- **Top Row (Main)**: `topRow`, `topRowKey`
- **Pager**: `pagerShell`, `pagerPage`, `pagerDotsRow`, `pagerDot`, `pagerDotActive`
- **Page 1 Header**: `pageOneHeader`, `topRowToggle`, `scalePickerColumn`
- **Dropdowns**: `dropdown`, `dropdownLabel`, `dropdownTrigger`, `dropdownItem`
- **Toggle Group**: `toggleGroup`, `toggleRow`, `toggleItem`
- **Properties**: `propertiesCard`, `propertiesTitle`, `propertiesField`, `propertiesRow`, `debugToggle`
- **Properties Toggles**: `propertiesToggleButton`, `propertiesToggleText`
- **Properties Choices**: `propertiesChoiceRow`, `propertiesChoiceButton`, `propertiesChoiceText`
- **Tab Symbols**: `symbolRow`, `symbolKey`, `symbolMeaning`
- **Listen Area (Main)**: `listenCard`, `listenRow`, `listenButton`, `listenValue`, `debugPanel`, `debugPanelLabel`
- **Results**: `resultsList`, `resultRow`, `resultHeader`, `resultTitle`
- **Main Tabs**: `tabGroupList`, `tabGroup`, `resultTabs`
- **Arpeggios**: `arpeggioSection`, `arpeggioBlock`, `arpeggioRow`, `arpeggioLabel`, `arpeggioTabList`, `arpeggioTabChip`
- **Tab Transposer**: `transposerCard`, `transposerTitle`, `transposerMeta`, `transposerFollowControls`, `transposerFollowStatus`, `transposerInput`, `transposerPadHint`, `transposerPadStatus`, `transposerActionButton`, `transposerDirectionRow`, `transposerDirectionOption`, `transposerOutputBox`, `transposerOutputToken`, `transposerOutputTokenActive`, `transposerOutputTokenMatched`, `transposerWarnings`
- **Tab Pad**: `transposerPadOverlay`, `transposerPadSheet`, `transposerPadHandle`, `transposerPadTitle`, `transposerPadPreview`, `transposerPadSection`, `transposerPadOptionRow`, `transposerPadOptionButton`, `transposerPadHoleGrid`, `transposerPadHoleButton`, `transposerPadActionRow`
