# UI Map

This document provides standard names for the app's UI sections, based on the style keys in `harmonica-tabs/App.tsx`.

## High-Level Layout (Top -> Bottom)

```text
SafeAreaView (styles.safeArea)
└─ ScrollView (styles.container)
   ├─ Header Row (styles.headerRow)
   │  ├─ Screen Title (styles.title)
   │  └─ Screen Toggle Button (styles.gearButton + styles.gearButtonText)
   └─ Screen Body (conditional)
      ├─ Scales Workspace (`screen === 'scales'`)
      │  ├─ Responsive Shell (`testID="scales-workspace-shell"`, wide screens may cap width)
      │  │  └─ Scales Content (`styles.scalesWorkspace`)
      │  ├─ Fixed Top Row
      │  │  └─ Container (styles.topRow)
      │  │     ├─ Harmonica Key (styles.topRowKey + styles.dropdown*)
      │  │     └─ Target Position/Key (styles.topRowKey + styles.dropdown*)
      │  ├─ Listen Card (styles.listenCard)
      │  │  ├─ Listen Row (styles.listenRow) — contains Listen Button only
      │  │  ├─ Status Line (styles.listenValue) — frequency/note data when on; prompt when off
      │  │  └─ Debug Panel (styles.debugPanel, conditional)
      │  ├─ Header Controls (styles.pageOneHeader)
      │  │  ├─ Scale Name (styles.scalePickerColumn + styles.dropdown*)
      │  │  └─ Arpeggios (styles.topRowToggle + styles.toggleGroup/toggleRow)
      │  └─ Results Scroll Area (`testID="scales-results-scroll"`, `styles.scalesResultsScroll`)
      │     └─ Results List (styles.resultsList)
      │        └─ Result Card (styles.resultRow)
      │        ├─ Main Tab Row (styles.tabGroupList)
      │        └─ Arpeggio Section (styles.arpeggioSection, conditional)
      ├─ Tabs Workspace (`screen === 'tabs'`)
      │  ├─ Transpose View (`tabsSubview === 'transpose'`)
      │  │  ├─ Fixed Top Row (styles.topRow)
      │  │  │  ├─ Harmonica Key (styles.topRowKey + styles.dropdown*)
      │  │  │  └─ Target Position/Key (styles.topRowKey + styles.dropdown*)
      │  │  └─ Transposer Card (styles.transposerCard)
      │  │     ├─ Tone Follow Controls (styles.transposerFollowControls)
      │  │     │  ├─ Shared Listen Button (styles.listenButton)
      │  │     │  └─ Inline Status/Error (styles.transposerSavedTabsStatus, conditional)
      │  │     ├─ Shared Debug Panel (styles.debugPanel, conditional)
      │  │     ├─ Source Actions (styles.transposerLibraryRow + styles.transposerActionButton)
      │  │     │  └─ Includes `Choose Tab` and `Edit Tab` / `Create Tab`
      │  │     ├─ Current Source Label (styles.transposerCurrentTab)
      │  │     ├─ Octave Shift Controls (styles.transposerDirectionRow + styles.transposerDirectionOption)
      │  │     │  └─ `Down` / `Up` step from the current display; `Base` resets to saved first position
      │  │     ├─ Transposed Tab Box (styles.transposerOutputBox + styles.transposerOutputText)
      │  │     │  └─ Bounded internal scroll area with clickable output tokens
      │  │     └─ Warnings (styles.transposerWarnings + styles.transposerWarningText)
      │  ├─ Library View (`tabsSubview === 'library'`)
      │  │  └─ Library Card (styles.propertiesCard)
      │  │     ├─ Section Title (styles.propertiesTitle)
      │  │     ├─ New Tab Button (styles.libraryNewButton)
      │  │     ├─ Status Text (styles.savedTabsStatus, conditional)
      │  │     └─ Saved Tab Scroll Area (styles.libraryListArea + styles.savedTabsList)
      │  │        └─ Saved Tab Rows (styles.savedTabRow)
      │  │           ├─ Row Header (styles.savedTabRowHeader)
      │  │           ├─ Preview (styles.savedTabPreview)
      │  │           ├─ Meta (styles.savedTabMeta) — harp/position context (when saved) + update timestamp
      │  │           └─ Row Actions (styles.savedTabActions + styles.savedTabActionButton)
      │  │              └─ Includes `Open`, `Edit`, and `Delete`
      │  └─ Editor Overlay (`screen === 'tabs'` + editor visible, modal)
      │     ├─ Overlay Header (styles.headerRow + styles.title)
      │     │  └─ Includes `Tab Editor` title
      │     └─ Editor Card (styles.transposerCard)
      │        ├─ Saved Context Selectors (styles.editorContextSelectors + styles.dropdown*)
      │        │  └─ Always visible; `Saved harmonica key` and `Saved position/key` dropdowns disabled when context is off
      │        ├─ Context Checkbox (styles.editorContextCheckboxRow)
      │        │  └─ `Save with key/position context` — enables/disables the selectors above
      │        ├─ Primary Action Row (styles.editorPrimaryRow + styles.editorPrimaryActionButton)
      │        │  └─ `Cancel` (dismiss), `Save` (primary, blue fill), `Save As` (secondary, outlined) — new drafts show only `Save`
      │        ├─ Clean Input Button (styles.editorSecondaryButton)
      │        ├─ Title Field (styles.editorTitleInput, testID="save-tab-title-input")
      │        │  └─ Inline editable title; pre-filled from saved tab or blank for new drafts; auto-suggests from content on save
      │        └─ Tab Content Input (styles.transposerInput, testID="editor-tab-input")
      ├─ Properties Screen (`screen === 'properties'`)
      │  └─ Properties Card (styles.propertiesCard)
      │     ├─ Section Title (styles.propertiesTitle)
      │     ├─ Overbend Symbol Select (styles.propertiesField + styles.dropdown*)
      │     ├─ Positions Select (styles.propertiesField + styles.dropdown*)
      │     ├─ Harmonica Keys Standard/Flat/Sharp Select (styles.propertiesField + styles.dropdown*)
      │     ├─ Target Keys Flat/Sharp Select (styles.propertiesField + styles.dropdown*)
      │     ├─ 2 Draw / 3 Blow Preference Select + Help Button (styles.dropdownLabelRow + styles.helpIconButton)
      │     ├─ Tone Tolerance Input + Help Button (styles.propertiesInlineField + styles.helpIconButton)
      │     ├─ Minimum Confidence Input + Help Button (styles.propertiesInlineField + styles.helpIconButton)
      │     ├─ Note Separation Input + Help Button (styles.propertiesInlineField + styles.helpIconButton)
      │     ├─ Debug Toggle Button (styles.propertiesRow + styles.debugToggle)
      │     └─ Tab Symbols Help Button (styles.propertiesRow + styles.debugToggle)
      ├─ Tab Symbols Screen (`screen === 'tab-symbols'`)
      │  └─ Symbols Card (styles.propertiesCard)
      │     ├─ Section Title (styles.propertiesTitle)
      │     └─ Symbol Rows (styles.symbolRow + styles.symbolKey + styles.symbolMeaning)
   ├─ Workspace Switcher (styles.workspaceNavRow, bottom-aligned on top-level screens)
   │  ├─ `Scales` button (styles.workspaceNavButton)
   │  └─ `Tabs` button (styles.workspaceNavButton)
   └─ Global Modals
      ├─ Unsaved Open Modal (styles.dialogOverlay + styles.dialogCard + styles.dialogActionColumn)
      ├─ Properties Help Dialogs (styles.dialogOverlay + styles.dialogCard)
      └─ Editor Close Confirmation Modal (styles.dialogOverlay + styles.dialogCard + styles.dialogActionColumn)
```

## Naming Reference

- **Header / Screen Nav**: `headerRow`, `title`, `gearButton`, `gearButtonText`
- **Top Row (Main)**: `topRow`, `topRowKey`
- **Workspace Nav**: `workspaceNavRow`, `workspaceNavButton`, `workspaceNavText`
- **Page 1 Header**: `pageOneHeader`, `topRowToggle`, `scalePickerColumn`
- **Dropdowns**: `dropdown`, `dropdownLabel`, `dropdownTrigger`, `dropdownItem`
- **Toggle Group**: `toggleGroup`, `toggleRow`, `toggleItem`
- **Properties**: `propertiesCard`, `propertiesTitle`, `propertiesField`, `propertiesRow`, `debugToggle`
- **Properties Toggles**: `propertiesToggleButton`, `propertiesToggleText`
- **Tab Symbols**: `symbolRow`, `symbolKey`, `symbolMeaning`
- **Listen Area (Main)**: `listenCard`, `listenRow`, `listenButton`, `listenValue` (status line below button row), `debugPanel`, `debugPanelLabel`
- **Scales Workspace**: `scalesWorkspace`, responsive shell via `testID="scales-workspace-shell"`, results scroller via `testID="scales-results-scroll"`
- **Results**: `resultsList`, `resultRow`, `resultHeader`, `resultTitle`
- **Main Tabs**: `tabGroupList`, `tabGroup`, `resultTabs`
- **Arpeggios**: `arpeggioSection`, `arpeggioBlock`, `arpeggioRow`, `arpeggioLabel`, `arpeggioTabList`, `arpeggioTabChip`
- **Tab Transposer**: `transposerCard`, `transposerFollowControls`, `transposerSavedTabsStatus`, `transposerCurrentTab`, `transposerLibraryRow`, `transposerActionButton`, `transposerDirectionRow`, `transposerDirectionOption`, `transposerOutputBox`, `transposerOutputToken`, `transposerOutputTokenActive`, `transposerOutputTokenMatched`, `transposerWarnings`
- **Tab Editor**: `editorDismissButton`, `editorSaveAsButton`, `editorTitleInput`, `editorContextCheckboxRow`, `editorContextCheckbox`, `editorContextSelectors`, `editorPrimaryRow`, `editorPrimaryActionButton`, `editorSecondaryButton`, `transposerInput`
- **Saved Tab Library**: `savedTabsStatus`, `libraryListArea`, `savedTabsList`, `savedTabRow`, `savedTabRowHeader`, `savedTabTitle`, `savedTabActiveBadge`, `savedTabPreview`, `savedTabMeta`, `savedTabActions`, `savedTabActionButton`, `libraryNewButton`
- **Dialogs**: `dialogOverlay`, `dialogCard`, `dialogTitle`, `dialogInput`, `dialogActionRow`, `dialogActionColumn`, `dialogButton`
