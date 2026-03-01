# UI Map

This document provides standard names for the app’s UI sections, based on the style keys in `harmonica-tabs/App.tsx`.

## High‑Level Layout (Top → Bottom)

```
SafeAreaView (styles.safeArea)
└─ ScrollView (styles.container)
   ├─ Title (styles.title)
   ├─ Top Row
   │  └─ Container (styles.topRow)
   │     ├─ Harmonica Key (styles.topRowKey + styles.dropdown*)
   │     ├─ Overbend Symbol (styles.topRowToggle + styles.dropdown*)
   │     └─ Arpeggios (styles.topRowToggle + styles.toggleGroup/toggleRow)
   ├─ Scale Picker Row
   │  └─ Container (styles.scalePickerRow)
   │     ├─ Scale Key (styles.scalePickerColumn + styles.dropdown*)
   │     └─ Scale Name (styles.scalePickerColumn + styles.dropdown*)
   ├─ Listen Card (styles.listenCard)
   │  ├─ Listen Row (styles.listenRow)
   │  │  ├─ Listen Button (styles.listenButton)
   │  │  ├─ Status Text (styles.listenValue)
   │  │  └─ Debug Toggle (styles.debugToggle)
   │  └─ Debug Panel (styles.debugPanel, conditional)
   │     ├─ Debug Text (styles.debugText)
   │     ├─ Debug Row (styles.debugRow)
   │     └─ Debug Input (styles.debugInput)
   └─ Results List (styles.resultsList)
      └─ Result Card (styles.resultRow)
         ├─ Result Header (styles.resultHeader)
         │  └─ Scale Title (styles.resultTitle)
         ├─ Main Tab Row (styles.tabGroupList)
         │  └─ Tab Chip (styles.tabGroup + styles.resultTabs)
         └─ Arpeggio Section (styles.arpeggioSection, conditional)
            ├─ Arpeggio Block (styles.arpeggioBlock)
            │  ├─ Arpeggio Title (styles.arpeggioTitle)
            │  ├─ Arpeggio Note (styles.arpeggioNote)
            │  └─ Arpeggio Row (styles.arpeggioRow)
            │     ├─ Arpeggio Label (styles.arpeggioLabel)
            │     └─ Arpeggio Tabs (styles.arpeggioTabList)
            │        └─ Arpeggio Tab Chip (styles.arpeggioTabChip + styles.arpeggioTabText)
```

## Naming Reference

- **Top Row**: `topRow`, `topRowKey`, `topRowToggle`
- **Dropdowns**: `dropdown`, `dropdownLabel`, `dropdownTrigger`, `dropdownItem`
- **Toggle Group**: `toggleGroup`, `toggleRow`, `toggleItem`
- **Scale Picker**: `scalePickerRow`, `scalePickerColumn`
- **Listen Area**: `listenCard`, `listenRow`, `listenButton`, `listenValue`, `debugToggle`, `debugPanel`
- **Results**: `resultsList`, `resultRow`, `resultHeader`, `resultTitle`
- **Main Tabs**: `tabGroupList`, `tabGroup`, `resultTabs`
- **Arpeggios**: `arpeggioSection`, `arpeggioBlock`, `arpeggioRow`, `arpeggioLabel`, `arpeggioTabList`, `arpeggioTabChip`

