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
      │  │  │        ├─ Input (styles.transposerInput)
      │  │  │        ├─ Direction Radio (styles.transposerDirectionRow + styles.transposerDirectionOption)
      │  │  │        ├─ Output Box (styles.transposerOutputBox + styles.transposerOutputText)
      │  │  │        └─ Warnings (styles.transposerWarnings + styles.transposerWarningText)
      │  │  └─ Pager Dots (styles.pagerDotsRow + styles.pagerDot)
      └─ Properties Screen (`screen === 'properties'`)
         └─ Properties Card (styles.propertiesCard)
            ├─ Section Title (styles.propertiesTitle)
            ├─ Overbend Symbol Select (styles.propertiesField + styles.dropdown*)
            ├─ Position/Key Set Select (styles.propertiesField + styles.dropdown*)
            ├─ 2 Draw / 3 Blow Preference Select (styles.propertiesField + styles.dropdown*)
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
- **Tab Symbols**: `symbolRow`, `symbolKey`, `symbolMeaning`
- **Listen Area (Main)**: `listenCard`, `listenRow`, `listenButton`, `listenValue`, `debugPanel`, `debugPanelLabel`
- **Results**: `resultsList`, `resultRow`, `resultHeader`, `resultTitle`
- **Main Tabs**: `tabGroupList`, `tabGroup`, `resultTabs`
- **Arpeggios**: `arpeggioSection`, `arpeggioBlock`, `arpeggioRow`, `arpeggioLabel`, `arpeggioTabList`, `arpeggioTabChip`
- **Tab Transposer**: `transposerCard`, `transposerTitle`, `transposerMeta`, `transposerInput`, `transposerDirectionRow`, `transposerDirectionOption`, `transposerOutputBox`, `transposerWarnings`
