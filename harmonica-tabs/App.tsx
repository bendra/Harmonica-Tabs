import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { noteToPc, pcToNote, NoteName } from './src/data/notes';
import { HARMONICA_KEYS, HarmonicaKey } from './src/data/keys';
import { buildTabsForPcSet, OverbendNotation, TabGroup } from './src/logic/tabs';
import { ArpeggioSection } from './src/logic/arpeggios';
import {
  useMusicalSelection,
  buildScaleKeyOptions,
  DropdownOption,
  HarmonicaNoteLabelStyle,
  NoteLabelStyle,
  PositionKeyFilter,
  ScaleKeyOption,
  formatPositionKeyLabel,
  formatOrdinal,
  formatScaleLabel,
  getPositionNumberForTargetRootPc,
  getPreferredTabOption,
  getTargetRootPcForPosition,
} from './src/hooks/use-musical-selection';
import { matchFrequencyToTabs, TabPitchMatch } from './src/logic/pitch';
import { DEFAULT_AUDIO_SETTINGS } from './src/config/default-settings';
import {
  formatSavedTabPreview,
  getSavedTabContext,
  SavedTabRecord,
} from './src/logic/saved-tab-library';
import { useSavedTabLibrary } from './src/hooks/use-saved-tab-library';
import { useAudioSettings } from './src/hooks/use-audio-settings';
import { AudioListeningProvider, useAudioListening } from './src/hooks/use-audio-listening';
import { useTransposerSession } from './src/hooks/use-transposer-session';
import { useTabEditor, SaveTabMode, TabsSubview } from './src/hooks/use-tab-editor';

function getLayoutTier(shortEdge: number): LayoutTier {
  if (shortEdge < 420) return 'compact';
  if (shortEdge >= 768) return 'wide';
  return 'regular';
}


function getScalesLayoutMetrics(layoutTier: LayoutTier) {
  switch (layoutTier) {
    case 'wide':
      return {
        contentMaxWidth: 1280,
        containerPadding: 28,
        workspaceGap: 16,
        sectionGap: 16,
        cardPadding: 16,
        listenCardPadding: 16,
        controlSize: 'wide' as ResponsiveControlSize,
        listenButtonMinHeight: 64,
        listenButtonPaddingVertical: 12,
        listenButtonPaddingHorizontal: 18,
        listenTitleFontSize: 14,
        listenStateFontSize: 12,
        listenValueFontSize: 16,
        titleFontSize: 18,
        checkboxFontSize: 14,
        tabFontSize: 18,
        tabLineHeight: 26,
        tabRootFontSize: 21,
        tabChipPaddingVertical: 5,
        tabChipPaddingHorizontal: 10,
        tabGap: 8,
        arpeggioTitleFontSize: 15,
        arpeggioNoteFontSize: 12,
        arpeggioLabelFontSize: 14,
        arpeggioTabFontSize: 14,
        arpeggioTabPaddingHorizontal: 4,
        arpeggioTabGap: 6,
      };
    case 'regular':
      return {
        contentMaxWidth: null,
        containerPadding: 24,
        workspaceGap: 12,
        sectionGap: 14,
        cardPadding: 12,
        listenCardPadding: 12,
        controlSize: 'regular' as ResponsiveControlSize,
        listenButtonMinHeight: 56,
        listenButtonPaddingVertical: 10,
        listenButtonPaddingHorizontal: 16,
        listenTitleFontSize: 13,
        listenStateFontSize: 11,
        listenValueFontSize: 15,
        titleFontSize: 17,
        checkboxFontSize: 13,
        tabFontSize: 16,
        tabLineHeight: 24,
        tabRootFontSize: 18,
        tabChipPaddingVertical: 4,
        tabChipPaddingHorizontal: 8,
        tabGap: 6,
        arpeggioTitleFontSize: 14,
        arpeggioNoteFontSize: 12,
        arpeggioLabelFontSize: 13,
        arpeggioTabFontSize: 12,
        arpeggioTabPaddingHorizontal: 3,
        arpeggioTabGap: 4,
      };
    case 'compact':
    default:
      return {
        contentMaxWidth: null,
        containerPadding: 20,
        workspaceGap: 10,
        sectionGap: 12,
        cardPadding: 10,
        listenCardPadding: 0,
        controlSize: 'regular' as ResponsiveControlSize,
        listenButtonMinHeight: 0,
        listenButtonPaddingVertical: 8,
        listenButtonPaddingHorizontal: 12,
        listenTitleFontSize: 12,
        listenStateFontSize: 11,
        listenValueFontSize: 14,
        titleFontSize: 16,
        checkboxFontSize: 12,
        tabFontSize: 14,
        tabLineHeight: 20,
        tabRootFontSize: 16,
        tabChipPaddingVertical: 2,
        tabChipPaddingHorizontal: 5,
        tabGap: 4,
        arpeggioTitleFontSize: 13,
        arpeggioNoteFontSize: 11,
        arpeggioLabelFontSize: 12,
        arpeggioTabFontSize: 11,
        arpeggioTabPaddingHorizontal: 2,
        arpeggioTabGap: 2,
      };
  }
}


type LayoutTier = 'compact' | 'regular' | 'wide';
type ResponsiveControlSize = 'compact' | 'regular' | 'wide';

type SingleSelectOption<T extends string> = {
  label: string;
  value: T;
};

type AppScreen = 'scales' | 'tabs' | 'properties' | 'tab-symbols';
type LayoutRect = { x: number; y: number; width: number; height: number };

function sameLayoutRect(a: LayoutRect | undefined, b: LayoutRect) {
  return !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}


function formatSavedTabTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}


function isSavedTabsErrorStatus(value: string | null) {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized.includes('could not') || normalized.includes('enter some tab text');
}

/**
 * Reusable single-value dropdown rendered with a modal menu.
 */
function Dropdown<T extends string | number>(props: {
  label: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  compact?: boolean;
  size?: ResponsiveControlSize;
  testID?: string;
  disabled?: boolean;
}) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [menuLayout, setMenuLayout] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const triggerRef = useRef<View>(null);
  const active = props.options.find((opt) => opt.value === props.value);
  const controlSize = props.size ?? 'regular';
  const compact = props.compact || controlSize === 'compact';
  const wide = controlSize === 'wide';

  function openMenu() {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setMenuLayout({ x, y, width, height });
      setOpen(true);
    });
  }

  return (
    <View testID={props.testID} style={[styles.dropdown, compact && styles.dropdownCompact, props.disabled && styles.dropdownDisabled]}>
      <Text style={[styles.dropdownLabel, compact && styles.dropdownLabelCompact, wide && styles.dropdownLabelWide]}>
        {props.label}
      </Text>
      <Pressable
        ref={triggerRef}
        onPress={() => {
          if (props.disabled) return;
          open ? setOpen(false) : openMenu();
        }}
        style={[
          styles.dropdownTrigger,
          compact && styles.dropdownTriggerCompact,
          wide && styles.dropdownTriggerWide,
          open && styles.dropdownTriggerOpen,
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.dropdownTriggerText,
            compact && styles.dropdownTriggerTextCompact,
            wide && styles.dropdownTriggerTextWide,
          ]}
        >
          {active?.label ?? 'Select'}
        </Text>
        <Text style={[styles.dropdownCaret, compact && styles.dropdownCaretCompact, wide && styles.dropdownCaretWide]}>
          {open ? '▲' : '▼'}
        </Text>
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.dropdownOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View
            style={[
              styles.dropdownMenuOverlay,
              {
                left: Math.max(12, Math.min(menuLayout.x, windowWidth - menuLayout.width - 12)),
                top: menuLayout.y + menuLayout.height + 6,
                width: menuLayout.width,
                maxHeight: Math.max(120, windowHeight - (menuLayout.y + menuLayout.height + 18)),
              },
            ]}
          >
            <ScrollView>
              {props.options.map((option) => (
                <Pressable
                  key={String(option.value)}
                  onPress={() => {
                    props.onChange(option.value);
                    setOpen(false);
                  }}
                  style={styles.dropdownItem}
                >
                  <Text style={[styles.dropdownItemText, wide && styles.dropdownItemTextWide]}>{option.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * Toggle-style single select list used for arpeggio mode selection.
 */
function SingleSelectGroup<T extends string>(props: {
  label: string;
  options: SingleSelectOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  size?: ResponsiveControlSize;
}) {
  const controlSize = props.size ?? 'regular';
  const wide = controlSize === 'wide';

  return (
    <View style={styles.toggleGroup}>
      <Text style={[styles.dropdownLabel, wide && styles.dropdownLabelWide]}>{props.label}</Text>
      <View style={styles.toggleRow}>
        {props.options.map((option) => {
          const selected = props.value === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => props.onChange(selected ? null : option.value)}
              style={[styles.toggleItem, wide && styles.toggleItemWide, selected && styles.toggleItemSelected]}
            >
              <Text
                style={[
                  styles.toggleItemText,
                  wide && styles.toggleItemTextWide,
                  selected && styles.toggleItemTextSelected,
                ]}
              >
                {selected ? '●' : '○'} {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

type ScalesWorkspaceProps = {
  scalesLayout: ReturnType<typeof getScalesLayoutMetrics>;
  isSmallScreen: boolean;
  harmonicaKey: HarmonicaKey;
  harmonicaKeyDropdownOptions: DropdownOption<number>[];
  onHarmonicaKeyChange: (key: HarmonicaKey) => void;
  scaleRoot: NoteName;
  scaleKeyDropdownOptions: DropdownOption<NoteName>[];
  onScaleRootChange: (root: NoteName) => void;
  scaleId: string;
  onScaleIdChange: (value: string) => void;
  scale: { rootPc: number; scaleId: string };
  groups: TabGroup[];
  selectedTabs: TabGroup['options'][number][];
  arpeggioSections: ArpeggioSection[];
  arpeggioSelection: 'triads' | 'sevenths' | 'blues' | null;
  onArpeggioSelectionChange: (value: 'triads' | 'sevenths' | 'blues' | null) => void;
  scaleNameDropdownOptions: DropdownOption<string>[];
  targetKeyPreferFlats: boolean;
  toneToleranceCents: number;
  showDebug: boolean;
  simFrequency: string;
  setSimFrequency: (value: string) => void;
  notation: OverbendNotation;
  gAltPreference: '-2' | '3';
  transposerFollowStatus: string;
};

type TabsTransposeViewProps = {
  isSmallScreen: boolean;
  transposerOutputMaxHeight: number;
  transposerOutputTextStyle: { fontSize: number; lineHeight: number };
  harmonicaKey: HarmonicaKey;
  harmonicaKeyDropdownOptions: DropdownOption<number>[];
  onHarmonicaKeyChange: (key: HarmonicaKey) => void;
  scaleRoot: NoteName;
  scaleKeyDropdownOptions: DropdownOption<NoteName>[];
  onScaleRootChange: (root: NoteName) => void;
  transposerSourceTabId: string | null;
  onTransposerSourceTabChange: (value: string | null) => void;
  transposerOctaveOffset: number;
  setTransposerOctaveOffset: React.Dispatch<React.SetStateAction<number>>;
  savedTabs: SavedTabRecord[];
  notation: OverbendNotation;
  gAltPreference: '-2' | '3';
  toneToleranceCents: number;
  toneFollowMinConfidence: number;
  targetRootPc: number;
  firstPositionRoot: NoteName;
  setSavedTabsStatus: (value: string | null) => void;
  setTabsSubview: (value: TabsSubview) => void;
  openSavedTabInEditor: (record: SavedTabRecord, returnTo: TabsSubview) => void;
  openEditorForNewDraft: (returnTo: TabsSubview) => void;
  showDebug: boolean;
  simFrequency: string;
  setSimFrequency: (value: string) => void;
  onFollowStatusChange: (value: string) => void;
};

function ToneFollowDebugPanel(props: {
  detectedRms: number;
  detectedConfidence: number;
  detectedFrequency: number | null;
  detectedRawFrequency: number | null;
  lastDetectedAt: number | null;
  detectedCandidates: Array<{ frequency: number; confidence: number }>;
  listenSource: 'web' | 'sim' | null;
  simFrequency: string;
  setSimFrequency: (value: string) => void;
  followStatus: string;
}) {
  const now = Date.now();

  return (
    <View style={styles.debugPanel}>
      <Text style={styles.debugPanelLabel}>Debug Panel</Text>
      <Text style={styles.debugText}>
        RMS: {props.detectedRms.toFixed(4)} · Conf: {props.detectedConfidence.toFixed(2)} · Hz:{' '}
        {props.detectedFrequency ? props.detectedFrequency.toFixed(1) : '—'} · Raw:{' '}
        {props.detectedRawFrequency ? props.detectedRawFrequency.toFixed(1) : '—'}
      </Text>
      <Text style={styles.debugText}>
        Last detect: {props.lastDetectedAt ? `${now - props.lastDetectedAt}ms ago` : '—'} · Status:{' '}
        {props.followStatus}
      </Text>
      {props.detectedCandidates.length > 0 && (
        <Text style={styles.debugText}>
          Top candidates:{' '}
          {props.detectedCandidates
            .map((candidate) => `${candidate.frequency.toFixed(1)}Hz (${(candidate.confidence * 100).toFixed(1)}%)`)
            .join(' · ')}
        </Text>
      )}
      <View style={styles.debugRow}>
        <Text style={styles.debugLabel}>Source</Text>
        <Text style={styles.debugTextInline}>
          {props.listenSource === 'web'
            ? 'Mic input (web)'
            : props.listenSource === 'sim'
              ? 'Simulated Hz (fallback)'
              : '—'}
        </Text>
      </View>
      <View style={styles.debugRow}>
        <Text style={styles.debugLabel}>Sim Hz</Text>
        <TextInput
          value={props.simFrequency}
          onChangeText={props.setSimFrequency}
          keyboardType="numeric"
          style={styles.debugInput}
          placeholder={DEFAULT_AUDIO_SETTINGS.simFrequencyInput}
          placeholderTextColor="#64748b"
        />
      </View>
    </View>
  );
}

function formatNotes(pcs: number[], rootPc: number, preferFlats: boolean) {
  return pcs.map((pc, index) => (
    <Text key={`${pc}:${index}`} style={pc === rootPc ? styles.arpeggioNotesRoot : undefined}>
      {index === 0 ? pcToNote(pc, preferFlats) : `–${pcToNote(pc, preferFlats)}`}
    </Text>
  ));
}

const ScalesWorkspace = React.memo(function ScalesWorkspace(props: ScalesWorkspaceProps) {
  const {
    isListening,
    listenError,
    listenSource,
    detectedFrequency,
    detectedRawFrequency,
    detectedConfidence,
    detectedRms,
    detectedCandidates,
    lastDetectedAt,
    audioSnapshot,
    startListening,
    stopListening,
  } = useAudioListening();
  const [tabLayouts, setTabLayouts] = useState<LayoutRect[]>([]);
  const [arpeggioLayouts, setArpeggioLayouts] = useState<Record<string, LayoutRect[]>>({});
  const [mainSelected, setMainSelected] = useState(true);
  const [arpeggioItemSelected, setArpeggioItemSelected] = useState<Record<string, boolean>>({});
  const arpeggioLayoutLogCountRef = useRef(0);
  const lastCaretVisibleRef = useRef(false);

  const frequency = audioSnapshot.frequency;
  const midis = props.groups.map((group) => group.midi);
  const pitchMatch = isListening && frequency ? matchFrequencyToTabs(midis, frequency, 25) : null;
  const caretPos = mainSelected ? getCaretPosition(pitchMatch, tabLayouts) : null;
  const mainInTune = pitchMatch !== null && Math.abs(pitchMatch.centsOffset) <= props.toneToleranceCents;
  const activeTab = pitchMatch ? props.selectedTabs[pitchMatch.activeIndex] : null;
  const effectiveConfidence = audioSnapshot.confidence;
  const statusText = isListening
    ? listenError
      ? listenError
      : activeTab && effectiveConfidence >= DEFAULT_AUDIO_SETTINGS.confidenceGate
        ? `${activeTab.tab} • ${frequency?.toFixed(1)} Hz ${pitchMatch ? formatCents(pitchMatch.centsOffset) : ''}`
        : 'No signal'
    : 'Tap to start pitch detection';
  const caretSize = 18;

  useEffect(() => {
    const caretVisible = caretPos !== null;
    if (lastCaretVisibleRef.current === caretVisible) return;
    lastCaretVisibleRef.current = caretVisible;
    console.log('[caret]', {
      visible: caretVisible,
      mainSelected,
      isListening,
    });
  }, [caretPos, isListening, mainSelected]);

  const scalesWorkspaceShellStyle = [
    styles.scalesWorkspaceShell,
    props.scalesLayout.contentMaxWidth
      ? {
          maxWidth: props.scalesLayout.contentMaxWidth,
          alignSelf: 'center' as const,
        }
      : null,
  ];
  const scalesWorkspaceStyle = {
    gap: props.scalesLayout.workspaceGap,
  };
  const scalesTopRowStyle = {
    gap: props.scalesLayout.sectionGap,
  };
  const scalesPageHeaderStyle = {
    gap: props.scalesLayout.sectionGap,
  };
  const scalesListenCardStyle = {
    padding: props.scalesLayout.listenCardPadding,
    gap: Math.max(6, Math.round(props.scalesLayout.sectionGap / 2)),
  };
  const scalesListenRowStyle = {
    gap: Math.max(8, Math.round(props.scalesLayout.sectionGap / 1.5)),
  };
  const scalesListenButtonStyle = {
    minHeight: props.scalesLayout.listenButtonMinHeight || undefined,
    paddingVertical: props.scalesLayout.listenButtonPaddingVertical,
    paddingHorizontal: props.scalesLayout.listenButtonPaddingHorizontal,
  };
  const scalesListenButtonTitleStyle = {
    fontSize: props.scalesLayout.listenTitleFontSize,
  };
  const scalesListenValueStyle = {
    fontSize: props.scalesLayout.listenValueFontSize,
  };
  const scalesResultRowStyle = {
    padding: props.scalesLayout.cardPadding,
  };
  const scalesCheckboxStyle = {
    fontSize: props.scalesLayout.checkboxFontSize,
  };
  const scalesResultTitleStyle = {
    fontSize: props.scalesLayout.titleFontSize,
  };
  const scalesResultTabsStyle = {
    fontSize: props.scalesLayout.tabFontSize,
    lineHeight: props.scalesLayout.tabLineHeight,
  };
  const scalesResultTabsRootStyle = {
    fontSize: props.scalesLayout.tabRootFontSize,
  };
  const scalesTabGroupListStyle = {
    gap: props.scalesLayout.tabGap,
  };
  const scalesTabGroupStyle = {
    paddingVertical: props.scalesLayout.tabChipPaddingVertical,
    paddingHorizontal: props.scalesLayout.tabChipPaddingHorizontal,
  };
  const scalesArpeggioSectionStyle = {
    gap: Math.max(6, Math.round(props.scalesLayout.sectionGap / 2)),
  };
  const scalesArpeggioBlockStyle = {
    gap: Math.max(4, Math.round(props.scalesLayout.sectionGap / 3)),
  };
  const scalesArpeggioTitleStyle = {
    fontSize: props.scalesLayout.arpeggioTitleFontSize,
  };
  const scalesArpeggioNoteStyle = {
    fontSize: props.scalesLayout.arpeggioNoteFontSize,
  };
  const scalesArpeggioLabelStyle = {
    fontSize: props.scalesLayout.arpeggioLabelFontSize,
    lineHeight: Math.round(props.scalesLayout.arpeggioLabelFontSize * 1.45),
  };
  const scalesArpeggioTabsStyle = {
    fontSize: props.scalesLayout.arpeggioTabFontSize,
  };
  const scalesArpeggioTabListStyle = {
    gap: props.scalesLayout.arpeggioTabGap,
  };
  const scalesArpeggioTabChipStyle = {
    paddingHorizontal: props.scalesLayout.arpeggioTabPaddingHorizontal,
  };
  const scalesArpeggioTabValueStyle = {
    fontSize: props.scalesLayout.arpeggioTabFontSize,
  };

  return (
    <View testID="scales-workspace-shell" style={scalesWorkspaceShellStyle}>
      <View testID="scales-workspace" style={[styles.scalesWorkspace, scalesWorkspaceStyle]}>
        <View style={[styles.topRow, scalesTopRowStyle]}>
          <View style={styles.topRowKey}>
            <Dropdown
              label="Harmonica key"
              value={props.harmonicaKey.pc}
              size={props.scalesLayout.controlSize}
              options={props.harmonicaKeyDropdownOptions}
              onChange={(pc) => {
                const nextKey = HARMONICA_KEYS.find((item) => item.pc === pc);
                if (nextKey) props.onHarmonicaKeyChange(nextKey);
              }}
            />
          </View>
          <View style={styles.topRowKey}>
            <Dropdown
              label="Target Position/Key"
              value={props.scaleRoot}
              size={props.scalesLayout.controlSize}
              options={props.scaleKeyDropdownOptions}
              onChange={props.onScaleRootChange}
            />
          </View>
        </View>

        <View style={[styles.listenCard, scalesListenCardStyle]}>
          <View style={[styles.listenRow, scalesListenRowStyle]}>
            <Pressable
              onPress={() => {
                if (isListening) {
                  stopListening();
                } else {
                  void startListening();
                }
              }}
              style={[styles.listenButton, scalesListenButtonStyle, isListening && styles.listenButtonActive]}
            >
              <View style={styles.listenButtonContent}>
                <Text
                  style={[
                    styles.listenButtonTitle,
                    scalesListenButtonTitleStyle,
                    isListening && styles.listenButtonTextActive,
                  ]}
                >
                  🎤 Listen
                </Text>
              </View>
            </Pressable>
          </View>
          <Text style={[styles.listenValue, scalesListenValueStyle]}>{statusText}</Text>
          {props.showDebug && (
            <ToneFollowDebugPanel
              detectedRms={detectedRms}
              detectedConfidence={detectedConfidence}
              detectedFrequency={detectedFrequency}
              detectedRawFrequency={detectedRawFrequency}
              lastDetectedAt={lastDetectedAt}
              detectedCandidates={detectedCandidates}
              listenSource={listenSource}
              simFrequency={props.simFrequency}
              setSimFrequency={props.setSimFrequency}
              followStatus={props.transposerFollowStatus}
            />
          )}
        </View>

        <View style={[styles.pageOneHeader, scalesPageHeaderStyle]}>
          <View style={styles.scalePickerColumn}>
            <Dropdown
              label="Scale Name"
              value={props.scaleId}
              size={props.scalesLayout.controlSize}
              options={props.scaleNameDropdownOptions}
              onChange={props.onScaleIdChange}
            />
          </View>
          <View style={styles.topRowToggle}>
            <SingleSelectGroup
              label="Arpeggios"
              size={props.scalesLayout.controlSize}
              value={props.arpeggioSelection}
              options={[
                { label: 'Triads', value: 'triads' },
                { label: '7th', value: 'sevenths' },
                { label: 'Blues', value: 'blues' },
              ]}
              onChange={props.onArpeggioSelectionChange}
            />
          </View>
        </View>

        <ScrollView
          testID="scales-results-scroll"
          style={styles.scalesResultsScroll}
          contentContainerStyle={styles.resultsList}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          <View key={`result:${props.scale.rootPc}:${props.scale.scaleId}`} style={[styles.resultRow, scalesResultRowStyle]}>
            <Pressable onPress={() => setMainSelected((prev) => !prev)} style={styles.resultHeader}>
              <View style={styles.checkboxRow}>
                <Text style={[styles.checkbox, scalesCheckboxStyle]}>{mainSelected ? '☑' : '☐'}</Text>
                <Text style={[styles.resultTitle, scalesResultTitleStyle]}>
                  {formatScaleLabel(props.scale.rootPc, props.scale.scaleId, props.targetKeyPreferFlats)}
                </Text>
              </View>
            </Pressable>
            {!mainSelected ? null : props.groups.length === 0 ? (
              <Text style={[styles.resultTabs, scalesResultTabsStyle]}>No tabs available.</Text>
            ) : (
              <View style={[styles.tabGroupList, scalesTabGroupListStyle]}>
                {caretPos !== null && (
                  <View
                    testID="main-tab-caret"
                    style={[
                      styles.tabCaret,
                      mainInTune && styles.tabCaretInTune,
                      { left: caretPos.left, top: caretPos.top, width: caretSize, height: caretSize },
                    ]}
                  />
                )}
                {props.groups.map((group, index) => {
                  const option = props.selectedTabs[index];
                  return (
                    <Pressable
                      key={`${props.scale.rootPc}:${props.scale.scaleId}:${group.midi}`}
                      testID={`main-tab-group:${index}`}
                      onLayout={(event) => {
                        const nextLayout = event.nativeEvent.layout as LayoutRect;
                        setTabLayouts((prev) => {
                          const previous = prev[index];
                          const changed = !sameLayoutRect(previous, nextLayout);
                          console.log('[layout main]', {
                            index,
                            changed,
                            prev: previous ?? null,
                            next: nextLayout,
                          });
                          const next = [...prev];
                          next[index] = nextLayout;
                          return next;
                        });
                      }}
                      onPress={() => setMainSelected((prev) => !prev)}
                      style={[styles.tabGroup, scalesTabGroupStyle, props.isSmallScreen && styles.tabGroupCompact]}
                    >
                      <Text
                        style={[
                          styles.resultTabs,
                          scalesResultTabsStyle,
                          props.isSmallScreen && styles.resultTabsSmall,
                          option.isRoot && styles.resultTabsRoot,
                          option.isRoot && scalesResultTabsRootStyle,
                        ]}
                      >
                        {option.tab}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {props.arpeggioSections.length > 0 && (
              <View style={[styles.arpeggioSection, scalesArpeggioSectionStyle]}>
                {props.arpeggioSections.map((section) => (
                  <View key={`arp:${section.id}`} style={[styles.arpeggioBlock, scalesArpeggioBlockStyle]}>
                    <Text style={[styles.arpeggioTitle, scalesArpeggioTitleStyle]}>{section.title}</Text>
                    {section.note && <Text style={[styles.arpeggioNote, scalesArpeggioNoteStyle]}>{section.note}</Text>}
                    {section.items.length === 0 ? (
                      <Text style={[styles.arpeggioEmpty, scalesArpeggioTabsStyle]}>{section.emptyNote ?? 'None'}</Text>
                    ) : (
                      section.items.map((item) => {
                        const tabGroups = buildTabsForPcSet(item.pcs, item.rootPc, props.harmonicaKey.pc, props.notation);
                        const tabTokens = tabGroups
                          .map((group) => {
                            const option = getPreferredTabOption(group, props.gAltPreference);
                            return option
                              ? {
                                  tab: option.tab,
                                  isRoot: group.isRoot,
                                  midi: group.midi,
                                }
                              : null;
                          })
                          .filter(Boolean) as Array<{ tab: string; isRoot: boolean; midi: number }>;
                        const rowSelected = arpeggioItemSelected[item.id] ?? false;
                        const rowMatch =
                          isListening && frequency && rowSelected
                            ? matchFrequencyToTabs(
                                tabTokens.map((token) => token.midi),
                                frequency,
                                25,
                              )
                            : null;
                        const rowCaretPos = rowSelected ? getCaretPosition(rowMatch, arpeggioLayouts[item.id] ?? []) : null;
                        const rowInTune =
                          rowMatch !== null && Math.abs(rowMatch.centsOffset) <= props.toneToleranceCents;

                        return (
                          <Pressable
                            key={item.id}
                            onPress={(event) => {
                              event.stopPropagation?.();
                              setArpeggioItemSelected((prev) => ({
                                ...prev,
                                [item.id]: !(prev[item.id] ?? false),
                              }));
                            }}
                            style={styles.arpeggioRow}
                          >
                            <View style={styles.checkboxRow}>
                              <Text style={[styles.checkbox, scalesCheckboxStyle]}>
                                {arpeggioItemSelected[item.id] ? '☑' : '☐'}
                              </Text>
                              <Text style={[styles.arpeggioLabel, scalesArpeggioLabelStyle]}>
                                {item.label} · {formatNotes(item.orderedPcs, item.rootPc, props.targetKeyPreferFlats)}
                              </Text>
                            </View>
                            {rowSelected &&
                              (tabTokens.length === 0 ? (
                                <Text style={[styles.arpeggioTabs, scalesArpeggioTabsStyle]}>No tabs available.</Text>
                              ) : (
                                <View style={[styles.arpeggioTabList, scalesArpeggioTabListStyle]}>
                                  {rowCaretPos !== null && (
                                    <View
                                      style={[
                                        styles.tabCaret,
                                        rowInTune && styles.tabCaretInTune,
                                        { left: rowCaretPos.left, top: rowCaretPos.top, width: caretSize, height: caretSize },
                                      ]}
                                    />
                                  )}
                                  {tabTokens.map((token, index) => (
                                    <View
                                      key={`${item.id}:tab:${index}`}
                                      onLayout={(event) => {
                                        const nextLayout = event.nativeEvent.layout as LayoutRect;
                                        setArpeggioLayouts((prev) => {
                                          const previous = prev[item.id]?.[index];
                                          const changed = !sameLayoutRect(previous, nextLayout);
                                          if (arpeggioLayoutLogCountRef.current < 20) {
                                            arpeggioLayoutLogCountRef.current += 1;
                                            console.log('[layout arp]', {
                                              itemId: item.id,
                                              index,
                                              changed,
                                              prev: previous ?? null,
                                              next: nextLayout,
                                            });
                                          }
                                          const next = { ...prev };
                                          const row = [...(next[item.id] ?? [])];
                                          row[index] = nextLayout;
                                          next[item.id] = row;
                                          return next;
                                        });
                                      }}
                                      style={[
                                        styles.arpeggioTabChip,
                                        scalesArpeggioTabChipStyle,
                                        token.isRoot && styles.arpeggioTabChipRoot,
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.arpeggioTabValue,
                                          scalesArpeggioTabValueStyle,
                                          token.isRoot && styles.arpeggioTabValueRoot,
                                        ]}
                                      >
                                        {token.tab}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                              ))}
                          </Pressable>
                        );
                      })
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </View>
  );
});

const TabsTransposeView = React.memo(function TabsTransposeView(props: TabsTransposeViewProps) {
  const {
    isListening,
    listenSource,
    detectedFrequency,
    detectedRawFrequency,
    detectedConfidence,
    detectedRms,
    detectedCandidates,
    lastDetectedAt,
    audioSnapshot,
    startListening,
    stopListening,
  } = useAudioListening();
  const {
    transposerFollowState,
    transposerOutputViewportHeight,
    setTransposerOutputViewportHeight,
    transposerOutputTokenLayouts,
    setTransposerOutputTokenLayouts,
    transposerOutputScrollRef,
    transposerOutputScrollYRef,
    transposerSourceTab,
    transposerBaseShift,
    transposerResult,
    transposerNextDownResult,
    transposerNextUpResult,
    transposerDisplayShift,
    canStepTransposerDown,
    canStepTransposerUp,
    isTransposerBaseResetState,
    transposerFollowEvaluation,
    moveTransposerCursor,
  } = useTransposerSession({
    savedTabs: props.savedTabs,
    transposerSourceTabId: props.transposerSourceTabId,
    transposerOctaveOffset: props.transposerOctaveOffset,
    harmonicaPc: props.harmonicaKey.pc,
    targetRootPc: props.targetRootPc,
    notation: props.notation,
    gAltPreference: props.gAltPreference,
    audioSnapshot,
    toneToleranceCents: props.toneToleranceCents,
    toneFollowMinConfidence: props.toneFollowMinConfidence,
    isListening,
  });
  const canListenOnTransposer = transposerSourceTab !== null && transposerResult.playableTokens.length > 0;

  useEffect(() => {
    props.onFollowStatusChange(transposerFollowEvaluation.status);
    return () => props.onFollowStatusChange('idle');
  }, [props.onFollowStatusChange, transposerFollowEvaluation.status]);

  return (
    <>
      <View style={styles.topRow}>
        <View style={styles.topRowKey}>
          <Dropdown
            label="Harmonica key"
            value={props.harmonicaKey.pc}
            options={props.harmonicaKeyDropdownOptions}
            onChange={(pc) => {
              const nextKey = HARMONICA_KEYS.find((item) => item.pc === pc);
              if (nextKey) props.onHarmonicaKeyChange(nextKey);
            }}
          />
        </View>
        <View style={styles.topRowKey}>
          <Dropdown
            label="Target Position/Key"
            value={props.scaleRoot}
            options={props.scaleKeyDropdownOptions}
            onChange={props.onScaleRootChange}
          />
        </View>
      </View>
      <View style={[styles.transposerCard, styles.transposerCardGrow]}>
        <View style={styles.transposerFollowControls}>
          <Pressable
            testID="transposer-listen-button"
            disabled={!canListenOnTransposer && !isListening}
            onPress={() => {
              if (!canListenOnTransposer && !isListening) return;
              if (isListening) {
                stopListening();
              } else {
                void startListening();
              }
            }}
            style={[
              styles.listenButton,
              isListening && styles.listenButtonActive,
              !canListenOnTransposer && !isListening && styles.listenButtonDisabled,
            ]}
          >
            <View style={styles.listenButtonContent}>
              <Text
                style={[
                  styles.listenButtonTitle,
                  isListening && styles.listenButtonTextActive,
                  !canListenOnTransposer && !isListening && styles.listenButtonTextDisabled,
                ]}
              >
                🎤 Listen
              </Text>
            </View>
          </Pressable>
        </View>
        {props.showDebug && (
          <ToneFollowDebugPanel
            detectedRms={detectedRms}
            detectedConfidence={detectedConfidence}
            detectedFrequency={detectedFrequency}
            detectedRawFrequency={detectedRawFrequency}
            lastDetectedAt={lastDetectedAt}
            detectedCandidates={detectedCandidates}
            listenSource={listenSource}
            simFrequency={props.simFrequency}
            setSimFrequency={props.setSimFrequency}
            followStatus={transposerFollowEvaluation.status}
          />
        )}
        <View style={styles.transposerLibraryRow}>
          <Pressable
            testID="transposer-choose-tab-button"
            onPress={() => {
              props.setSavedTabsStatus(null);
              props.onTransposerSourceTabChange(null);
              props.setTabsSubview('library');
            }}
            style={[styles.transposerActionButton, props.isSmallScreen && styles.transposerActionButtonCompact]}
          >
            <Text
              style={[
                styles.transposerActionButtonText,
                props.isSmallScreen && styles.transposerActionButtonTextCompact,
              ]}
            >
              Choose Tab
            </Text>
          </Pressable>
          <Pressable
            testID="transposer-edit-tab-button"
            onPress={() => {
              if (transposerSourceTab) {
                props.openSavedTabInEditor(transposerSourceTab, 'transpose');
              } else {
                props.openEditorForNewDraft('transpose');
              }
            }}
            style={[styles.transposerActionButton, props.isSmallScreen && styles.transposerActionButtonCompact]}
          >
            <Text
              style={[
                styles.transposerActionButtonText,
                props.isSmallScreen && styles.transposerActionButtonTextCompact,
              ]}
            >
              {transposerSourceTab ? 'Edit Tab' : 'Create Tab'}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.transposerCurrentTab}>
          {transposerSourceTab ? `Current tab: ${transposerSourceTab.title}` : 'Current tab: none selected'}
        </Text>
        <View style={[styles.transposerDirectionRow, props.isSmallScreen && styles.transposerDirectionRowCompact]}>
          <Text style={[styles.transposerSectionLabel, props.isSmallScreen && styles.transposerSectionLabelCompact]}>
            Octave Shift
          </Text>
          <View
            style={[
              styles.transposerDirectionOptions,
              props.isSmallScreen && styles.transposerDirectionOptionsCompact,
            ]}
          >
            <Pressable
              testID="transposer-octave-down-button"
              disabled={!canStepTransposerDown}
              onPress={() => {
                if (!canStepTransposerDown) return;
                props.setTransposerOctaveOffset((prev) => prev - 1);
              }}
              style={[
                styles.transposerDirectionOption,
                props.isSmallScreen && styles.transposerDirectionOptionCompact,
                !canStepTransposerDown && styles.transposerDirectionOptionDisabled,
              ]}
            >
              <Text
                style={[
                  styles.transposerDirectionText,
                  props.isSmallScreen && styles.transposerDirectionTextCompact,
                  !canStepTransposerDown && styles.transposerDirectionTextDisabled,
                ]}
              >
                Down
              </Text>
            </Pressable>
            <Pressable
              testID="transposer-octave-base-button"
              disabled={transposerSourceTab === null}
              onPress={() => {
                if (!transposerSourceTab) return;
                props.onScaleRootChange(props.firstPositionRoot);
                props.setTransposerOctaveOffset(0);
              }}
              style={[
                styles.transposerDirectionOption,
                props.isSmallScreen && styles.transposerDirectionOptionCompact,
                isTransposerBaseResetState && styles.transposerDirectionOptionActive,
                transposerSourceTab === null && styles.transposerDirectionOptionDisabled,
              ]}
            >
              <Text
                style={[
                  styles.transposerDirectionText,
                  props.isSmallScreen && styles.transposerDirectionTextCompact,
                  transposerSourceTab === null && styles.transposerDirectionTextDisabled,
                ]}
              >
                Reset
              </Text>
            </Pressable>
            <Pressable
              testID="transposer-octave-up-button"
              disabled={!canStepTransposerUp}
              onPress={() => {
                if (!canStepTransposerUp) return;
                props.setTransposerOctaveOffset((prev) => prev + 1);
              }}
              style={[
                styles.transposerDirectionOption,
                props.isSmallScreen && styles.transposerDirectionOptionCompact,
                !canStepTransposerUp && styles.transposerDirectionOptionDisabled,
              ]}
            >
              <Text
                style={[
                  styles.transposerDirectionText,
                  props.isSmallScreen && styles.transposerDirectionTextCompact,
                  !canStepTransposerUp && styles.transposerDirectionTextDisabled,
                ]}
              >
                Up
              </Text>
            </Pressable>
          </View>
        </View>
        <ScrollView
          ref={transposerOutputScrollRef}
          testID="transposer-output-scroll"
          style={[
            styles.transposerOutputBox,
            styles.transposerOutputBoxGrow,
            { maxHeight: props.transposerOutputMaxHeight },
          ]}
          contentContainerStyle={styles.transposerOutputContent}
          nestedScrollEnabled
          onLayout={(event) => {
            setTransposerOutputViewportHeight(event.nativeEvent.layout.height);
          }}
          onScroll={(event) => {
            transposerOutputScrollYRef.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
        >
          <Text style={[styles.transposerOutputText, props.transposerOutputTextStyle]}>
            {transposerSourceTab === null
              ? 'Choose a saved tab to generate a transposed tab.'
              : transposerResult.outputSegments.map((segment, index) => (
                  <Text
                    key={`out:${index}`}
                    testID={segment.kind === 'token' ? `transposer-output-token:${segment.tokenIndex}` : undefined}
                    onPress={
                      segment.kind === 'token' && segment.tokenIndex !== undefined
                        ? () => moveTransposerCursor(segment.tokenIndex as number)
                        : undefined
                    }
                    onLayout={
                      segment.kind === 'token' && segment.tokenIndex !== undefined
                        ? (event) => {
                            const { y, height } = event.nativeEvent.layout;
                            setTransposerOutputTokenLayouts((prev) => {
                              const current = prev[segment.tokenIndex as number];
                              if (current && current.y === y && current.height === height) {
                                return prev;
                              }
                              return {
                                ...prev,
                                [segment.tokenIndex as number]: { y, height },
                              };
                            });
                          }
                        : undefined
                    }
                    style={[
                      segment.kind === 'error' && styles.transposerOutputError,
                      segment.kind === 'token' && styles.transposerOutputToken,
                      segment.kind === 'token' &&
                        segment.tokenIndex === transposerFollowState.activeTokenIndex &&
                        styles.transposerOutputTokenActive,
                      segment.kind === 'token' &&
                        segment.tokenIndex === transposerFollowState.activeTokenIndex &&
                        transposerFollowEvaluation.matchingTarget &&
                        styles.transposerOutputTokenMatched,
                    ]}
                  >
                    {segment.text}
                  </Text>
                ))}
          </Text>
        </ScrollView>
        {transposerResult.warnings.length > 0 && (
          <View style={styles.transposerWarnings}>
            {transposerResult.warnings.map((warning, index) => (
              <Text key={`warning:${index}`} style={styles.transposerWarningText}>
                • {warning}
              </Text>
            ))}
          </View>
        )}
      </View>
    </>
  );
});

function getCaretPosition(
  match: TabPitchMatch | null,
  layouts: Array<{ x: number; y: number; width: number; height: number }>,
) {
  const caretSize = 18;
  if (!match) return null;
  const leftLayout = layouts[match.leftIndex];
  const rightLayout = layouts[match.rightIndex];
  const activeLayout = layouts[match.activeIndex];
  if (!leftLayout || !rightLayout) return null;
  const leftCenterX = leftLayout.x + leftLayout.width / 2;
  const rightCenterX = rightLayout.x + rightLayout.width / 2;
  const t = match.leftIndex === match.rightIndex ? 0 : match.t;
  const centerX = leftCenterX + (rightCenterX - leftCenterX) * t;
  const leftCenterY = leftLayout.y + leftLayout.height / 2;
  const rightCenterY = rightLayout.y + rightLayout.height / 2;
  const rowThreshold = Math.max(leftLayout.height, rightLayout.height) * 0.6;
  const spansRows = Math.abs(leftCenterY - rightCenterY) > rowThreshold;
  let centerY = leftCenterY + (rightCenterY - leftCenterY) * t;

  if (spansRows && activeLayout) {
    centerY = activeLayout.y + activeLayout.height / 2;
  }

  return {
    left: centerX - caretSize / 2,
    top: centerY - caretSize / 2,
  };
}

/**
 * Main app screen for harmonica scale, arpeggio, and pitch-tracking views.
 */
export default function App() {
  const { width, height } = useWindowDimensions();
  const shortEdge = Math.min(width, height);
  const layoutTier = getLayoutTier(shortEdge);
  const scalesLayout = getScalesLayoutMetrics(layoutTier);
  const isSmallScreen = layoutTier === 'compact';
  const transposerOutputMaxHeight = Math.max(160, Math.round(height * (isSmallScreen ? 0.38 : 0.46)));
  const [screen, setScreen] = useState<AppScreen>('scales');
  const [tabsSubview, setTabsSubview] = useState<TabsSubview>('library');
  const [tabsEditorVisible, setTabsEditorVisible] = useState(false);
  const [propertiesReturnTo, setPropertiesReturnTo] = useState<'scales' | 'tabs'>('scales');
  const {
    harmonicaKey,
    setHarmonicaKey,
    harmonicaKeyLabelStyle,
    setHarmonicaKeyLabelStyle,
    harmonicaKeyPreferFlats,
    harmonicaKeyDropdownOptions,
    targetKeyLabelStyle,
    setTargetKeyLabelStyle,
    targetKeyPreferFlats,
    notation,
    setNotation,
    positionKeyFilter,
    setPositionKeyFilter,
    gAltPreference,
    setGAltPreference,
    arpeggioSelection,
    setArpeggioSelection,
    scaleRoot,
    setScaleRoot,
    scaleId,
    setScaleId,
    scale,
    groups,
    selectedTabs,
    arpeggioSections,
    scaleKeyOptions,
    visibleScaleKeyOptions,
    scaleKeyDropdownOptions,
    scaleNameDropdownOptions,
    firstPositionRoot,
  } = useMusicalSelection();
  const {
    showDebug,
    setShowDebug,
    toneToleranceInput,
    setToneToleranceInput,
    toneFollowMinConfidenceInput,
    setToneFollowMinConfidenceInput,
    simFrequency,
    setSimFrequency,
    toneToleranceCents,
    toneFollowMinConfidence,
    simHz,
    nativeFrameIntervalMsInput,
    setNativeFrameIntervalMsInput,
    nativeFrameIntervalMs,
  } = useAudioSettings();
  const {
    savedTabs,
    setSavedTabs,
    savedTabsStatus,
    setSavedTabsStatus,
    deleteSavedTab,
  } = useSavedTabLibrary();
  const [transposerSourceTabId, setTransposerSourceTabId] = useState<string | null>(null);
  const [transposerOctaveOffset, setTransposerOctaveOffset] = useState(0);
  const [transposerFollowStatus, setTransposerFollowStatus] = useState('idle');
  const {
    editorInput,
    setEditorInput,
    editorSelection,
    setEditorSelection,
    editorSavedTabId,
    editorReturnTo,
    saveTabTitleInput,
    saveTabTitleError,
    isSavingTab,
    pendingOpenRecord,
    setPendingOpenRecord,
    closeEditorModalVisible,
    setCloseEditorModalVisible,
    editorSavedTab,
    hasUnsavedEditorChanges,
    hasUnsavedTitleChange,
    hasUnsavedContextChanges,
    editorInputRef,
    handleEditorInputChange,
    handleCleanEditorInput,
    finishClosingEditor,
    handleEditorCloseRequest,
    openSavedTabInEditor,
    openEditorForNewDraft,
    handleDirectSave,
    handleSavedTabEditPress,
    handleDeleteSavedTab,
    saveWithContext,
    setSaveWithContext,
    draftSavedContext,
    setDraftSavedContext,
    handleSaveTabTitleInputChange,
  } = useTabEditor({
    savedTabs,
    setSavedTabs,
    setSavedTabsStatus,
    setTransposerSourceTabId,
    setTabsSubview,
    setTabsEditorVisible,
    setScreen,
    deleteSavedTab,
    currentHarmonicaPc: harmonicaKey.pc,
    currentPositionNumber: getPositionNumberForTargetRootPc(harmonicaKey.pc, scale.rootPc),
  });
  const [cleanInputHelpVisible, setCleanInputHelpVisible] = useState(false);
  const [pendingContextOpenRecord, setPendingContextOpenRecord] = useState<SavedTabRecord | null>(null);

  const savedTabsStatusIsError = isSavedTabsErrorStatus(savedTabsStatus);
  const currentPositionNumber = getPositionNumberForTargetRootPc(harmonicaKey.pc, scale.rootPc);
  const editorSavedContextPositionOptions = useMemo<DropdownOption<number>[]>(
    () =>
      draftSavedContext
        ? buildScaleKeyOptions(draftSavedContext.harmonicaPc, targetKeyPreferFlats).map((option) => ({
            label: formatPositionKeyLabel(option.position, noteToPc(option.note), targetKeyPreferFlats),
            value: option.position,
          }))
        : [],
    [draftSavedContext, targetKeyPreferFlats],
  );

  const pendingContextRecordContext = pendingContextOpenRecord ? getSavedTabContext(pendingContextOpenRecord) : null;
  const pendingContextTargetPc =
    pendingContextRecordContext !== null
      ? getTargetRootPcForPosition(
          pendingContextRecordContext.harmonicaPc,
          pendingContextRecordContext.positionNumber,
        )
      : null;
  const pendingContextCurrentHarpPosition =
    pendingContextTargetPc !== null
      ? getPositionNumberForTargetRootPc(harmonicaKey.pc, pendingContextTargetPc)
      : null;
  const pendingContextCurrentHarpVisible =
    pendingContextTargetPc !== null &&
    pendingContextCurrentHarpPosition !== null &&
    visibleScaleKeyOptions.some(
      (option) => option.position === pendingContextCurrentHarpPosition && noteToPc(option.note) === pendingContextTargetPc,
    );

  function ensurePositionVisible(positionNumber: number) {
    if (visibleScaleKeyOptions.some((option) => option.position === positionNumber)) {
      return;
    }

    setPositionKeyFilter('all');
  }

  function applyHarpAndTargetSelection(nextHarmonicaPc: number, nextPositionNumber: number) {
    const nextTargetRootPc = getTargetRootPcForPosition(nextHarmonicaPc, nextPositionNumber);
    const nextTargetRoot = pcToNote(nextTargetRootPc, targetKeyPreferFlats);

    ensurePositionVisible(nextPositionNumber);

    const nextHarmonicaKey = HARMONICA_KEYS.find((item) => item.pc === nextHarmonicaPc) ?? null;
    if (nextHarmonicaKey) {
      setHarmonicaKey(nextHarmonicaKey);
    }
    setScaleRoot(nextTargetRoot);
    setTransposerOctaveOffset(0);
  }

  function openSavedTabInTransposer(record: SavedTabRecord) {
    setTransposerSourceTabId(record.id);
    setSavedTabsStatus(`Selected "${record.title}" for transposing.`);
    setTabsEditorVisible(false);
    setTabsSubview('transpose');
    setScreen('tabs');
    setPendingContextOpenRecord(null);
  }

  function handleSavedTabOpenPress(record: SavedTabRecord) {
    const savedContext = getSavedTabContext(record);
    if (savedContext === null) {
      openSavedTabInTransposer(record);
      return;
    }

    if (
      savedContext.harmonicaPc === harmonicaKey.pc &&
      savedContext.positionNumber === currentPositionNumber
    ) {
      openSavedTabInTransposer(record);
      return;
    }

    setPendingContextOpenRecord(record);
  }

  function openTabsWorkspace() {
    console.log('[press] workspace-tabs-button', {
      screen,
      tabsSubview,
      tabsEditorVisible,
      transposerSourceTabId,
    });
    setTabsEditorVisible(false);
    setTabsSubview(transposerSourceTabId ? 'transpose' : 'library');
    setScreen('tabs');
  }

  function showTabsSubview(nextSubview: TabsSubview) {
    setTabsEditorVisible(false);
    setTabsSubview(nextSubview);
    setScreen('tabs');
  }
  const scalesContainerStyle = {
    padding: scalesLayout.containerPadding,
    gap: scalesLayout.workspaceGap,
  };
  const transposerOutputTextStyle = {
    fontSize: scalesLayout.tabFontSize,
    lineHeight: scalesLayout.tabLineHeight,
  };
  const isScalesScreen = screen === 'scales' && !tabsEditorVisible;

  const headerTitle =
    screen === 'properties'
      ? 'Properties'
      : screen === 'tab-symbols'
        ? 'Tab Symbols'
        : 'HarpPilot';

  const isTabsLibraryScreen = screen === 'tabs' && tabsSubview === 'library' && !tabsEditorVisible;
  const showBackButton = screen === 'properties' || screen === 'tab-symbols';
  const showWorkspaceSwitcher = (screen === 'scales' || screen === 'tabs') && !tabsEditorVisible;

  function handleHeaderButtonPress() {
    console.log('[press] header-button', {
      screen,
      showBackButton,
    });
    if (screen === 'properties') {
      setScreen(propertiesReturnTo);
      return;
    }
    if (screen === 'tab-symbols') {
      setScreen('properties');
      return;
    }
    setPropertiesReturnTo(screen);
    setScreen('properties');
  }

  function renderEditorOverlay() {
    return (
      <View style={{ flex: 1 }}>
        <SafeAreaView style={styles.safeArea}>
          <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
            <View style={styles.headerRow}>
              <Text style={styles.title}>Tab Editor</Text>
            </View>
            <View style={[styles.transposerCard, styles.transposerCardGrow]}>
              <View style={styles.editorContextSelectors}>
                <View style={styles.topRowKey}>
                  <Dropdown
                    testID="editor-context-harmonica-dropdown"
                    label="Saved harmonica key"
                    value={draftSavedContext?.harmonicaPc ?? harmonicaKey.pc}
                    options={harmonicaKeyDropdownOptions}
                    onChange={(nextHarmonicaPc) => {
                      setDraftSavedContext((prev) => ({
                        harmonicaPc: nextHarmonicaPc,
                        positionNumber: prev?.positionNumber ?? currentPositionNumber,
                      }));
                    }}
                    disabled={!saveWithContext}
                    size={isSmallScreen ? 'compact' : 'regular'}
                  />
                </View>
                <View style={styles.topRowKey}>
                  <Dropdown
                    testID="editor-context-position-dropdown"
                    label="Saved position/key"
                    value={draftSavedContext?.positionNumber ?? currentPositionNumber}
                    options={editorSavedContextPositionOptions}
                    onChange={(nextPositionNumber) => {
                      setDraftSavedContext((prev) => ({
                        harmonicaPc: prev?.harmonicaPc ?? harmonicaKey.pc,
                        positionNumber: nextPositionNumber,
                      }));
                    }}
                    disabled={!saveWithContext}
                    size={isSmallScreen ? 'compact' : 'regular'}
                  />
                </View>
              </View>
              <Pressable
                testID="editor-save-context-toggle"
                onPress={() => setSaveWithContext((prev) => !prev)}
                style={styles.editorContextCheckboxRow}
              >
                <View style={[styles.editorContextCheckbox, saveWithContext && styles.editorContextCheckboxChecked]}>
                  {saveWithContext && <Text style={styles.editorContextCheckmark}>✓</Text>}
                </View>
                <Text style={styles.editorContextCheckboxLabel}>Save with key/position context</Text>
              </Pressable>
              <View style={styles.editorPrimaryRow}>
                <Pressable
                  testID="editor-close-button"
                  onPress={handleEditorCloseRequest}
                  style={[
                    styles.editorDismissButton,
                    styles.editorPrimaryActionButton,
                    isSmallScreen && styles.transposerActionButtonCompact,
                  ]}
                >
                  <Text style={styles.editorDismissButtonText}>Cancel</Text>
                </Pressable>
                {editorSavedTabId ? (
                  <>
                    <Pressable
                      testID="editor-save-button"
                      onPress={() => void handleDirectSave('overwrite')}
                      disabled={isSavingTab || !hasUnsavedEditorChanges}
                      style={[
                        styles.transposerActionButton,
                        styles.editorPrimaryActionButton,
                        isSmallScreen && styles.transposerActionButtonCompact,
                        (isSavingTab || !hasUnsavedEditorChanges) && styles.dialogButtonDisabled,
                      ]}
                    >
                      <Text
                        style={[
                          styles.transposerActionButtonText,
                          isSmallScreen && styles.transposerActionButtonTextCompact,
                        ]}
                      >
                        {isSavingTab ? 'Saving…' : 'Save'}
                      </Text>
                    </Pressable>
                    <Pressable
                      testID="editor-save-as-button"
                      onPress={() => void handleDirectSave('create_new')}
                      disabled={isSavingTab || !(hasUnsavedTitleChange || hasUnsavedContextChanges)}
                      style={[
                        styles.editorSaveAsButton,
                        styles.editorPrimaryActionButton,
                        isSmallScreen && styles.transposerActionButtonCompact,
                        (isSavingTab || !(hasUnsavedTitleChange || hasUnsavedContextChanges)) && styles.dialogButtonDisabled,
                      ]}
                    >
                      <Text
                        style={[
                          styles.editorSaveAsButtonText,
                          isSmallScreen && styles.transposerActionButtonTextCompact,
                        ]}
                      >
                        Save As
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    testID="editor-save-button"
                    onPress={() => void handleDirectSave('create_new')}
                    disabled={isSavingTab || !hasUnsavedEditorChanges}
                    style={[
                      styles.transposerActionButton,
                      styles.editorPrimaryActionButton,
                      isSmallScreen && styles.transposerActionButtonCompact,
                      (isSavingTab || !hasUnsavedEditorChanges) && styles.dialogButtonDisabled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.transposerActionButtonText,
                        isSmallScreen && styles.transposerActionButtonTextCompact,
                      ]}
                    >
                      {isSavingTab ? 'Saving…' : 'Save'}
                    </Text>
                  </Pressable>
                )}
              </View>
              <View style={styles.cleanInputRow}>
                <Pressable
                  testID="editor-clean-button"
                  onPress={handleCleanEditorInput}
                  style={[
                    styles.editorSecondaryButton,
                    isSmallScreen && styles.editorSecondaryButtonCompact,
                  ]}
                >
                  <Text style={[styles.editorSecondaryButtonText, isSmallScreen && styles.editorSecondaryButtonTextCompact]}>
                    Clean Input
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setCleanInputHelpVisible(true)}
                  style={styles.helpIconButton}
                  accessibilityLabel="Help for Clean Input"
                >
                  <Text style={styles.helpIconText}>?</Text>
                </Pressable>
              </View>
              <TextInput
                testID="save-tab-title-input"
                value={saveTabTitleInput}
                onChangeText={handleSaveTabTitleInputChange}
                onSubmitEditing={() => void handleDirectSave(editorSavedTabId ? 'overwrite' : 'create_new')}
                style={styles.editorTitleInput}
                placeholder="Tab title"
                placeholderTextColor="#64748b"
                autoCorrect={false}
                autoCapitalize="sentences"
                spellCheck={false}
                returnKeyType="done"
              />
              {saveTabTitleError && <Text style={styles.dialogErrorText}>{saveTabTitleError}</Text>}
              <TextInput
                testID="editor-tab-input"
                ref={editorInputRef}
                style={[styles.transposerInput, styles.transposerInputGrow]}
                multiline
                value={editorInput}
                onChangeText={handleEditorInputChange}
                onSelectionChange={(event) => {
                  const selection = event.nativeEvent.selection;
                  setEditorSelection(selection);
                }}
                selection={editorSelection}
                keyboardType="default"
                inputMode="text"
                autoCorrect={false}
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Paste or type tab text here — e.g. 4 -4 5 -5 6"
                placeholderTextColor="#64748b"
                textAlignVertical="top"
              />
            </View>
          </ScrollView>
        </SafeAreaView>
        {cleanInputHelpVisible && (
          <View testID="clean-input-help-dialog" style={[StyleSheet.absoluteFill, styles.dialogOverlay]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setCleanInputHelpVisible(false)} />
            <View style={styles.dialogCard}>
              <Text style={styles.dialogTitle}>Clean Input</Text>
              <Text style={styles.helperText}>
                Removes all extranious text and spacing, leaving only the tab characters themselves.
              </Text>
              <Pressable onPress={() => setCleanInputHelpVisible(false)} style={styles.dialogButton}>
                <Text style={styles.dialogButtonText}>Got it</Text>
              </Pressable>
            </View>
          </View>
        )}
        {pendingOpenRecord !== null && (
          <View testID="pending-open-modal" style={[StyleSheet.absoluteFill, styles.dialogOverlay]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setPendingOpenRecord(null)} />
            <View style={styles.dialogCard}>
              <Text style={styles.dialogTitle}>Unsaved changes</Text>
              <Text style={styles.helperText}>
                Opening "{pendingOpenRecord?.title ?? 'this tab'}" will replace the current editor text.
              </Text>
              <View style={styles.dialogActionColumn}>
                <Pressable onPress={() => setPendingOpenRecord(null)} style={styles.dialogButton}>
                  <Text style={styles.dialogButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (pendingOpenRecord) {
                      openSavedTabInEditor(pendingOpenRecord, 'library');
                    }
                  }}
                  style={styles.dialogButton}
                >
                  <Text style={styles.dialogButtonText}>Open Anyway</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (!pendingOpenRecord) return;
                    void handleDirectSave('save_then_open', pendingOpenRecord.id);
                    setPendingOpenRecord(null);
                  }}
                  style={[styles.dialogButton, styles.dialogPrimaryButton]}
                >
                  <Text style={[styles.dialogButtonText, styles.dialogPrimaryButtonText]}>Save Then Open</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
        {closeEditorModalVisible && (
          <View testID="editor-close-confirm-modal" style={[StyleSheet.absoluteFill, styles.dialogOverlay]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setCloseEditorModalVisible(false)} />
            <View style={styles.dialogCard}>
              <Text style={styles.dialogTitle}>Unsaved changes</Text>
              <Text style={styles.helperText}>Closing the editor will discard the current unsaved changes.</Text>
              <View style={styles.dialogActionColumn}>
                <Pressable onPress={() => setCloseEditorModalVisible(false)} style={styles.dialogButton}>
                  <Text style={styles.dialogButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  testID="editor-close-discard-button"
                  onPress={finishClosingEditor}
                  style={styles.dialogButton}
                >
                  <Text style={styles.dialogButtonText}>Discard</Text>
                </Pressable>
                <Pressable
                  testID="editor-close-save-button"
                  onPress={() => {
                    void handleDirectSave('save_then_close');
                    setCloseEditorModalVisible(false);
                  }}
                  style={[styles.dialogButton, styles.dialogPrimaryButton]}
                >
                  <Text style={[styles.dialogButtonText, styles.dialogPrimaryButtonText]}>Save</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    );
  }

  function renderMainContent() {
    return (
      <>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{headerTitle}</Text>
          <Pressable onPress={handleHeaderButtonPress} style={styles.gearButton}>
            <Text style={styles.gearButtonText}>{showBackButton ? '←' : '⚙'}</Text>
          </Pressable>
        </View>

        {screen === 'properties' ? (
          <View style={styles.propertiesCard}>
            <Text style={styles.propertiesTitle}>Display</Text>
            <View style={styles.propertiesCompactDropdownRow}>
              <View style={styles.propertiesCompactDropdownField}>
                <Dropdown
                  compact
                  label="Overbend"
                  value={notation}
                  options={[
                    { label: "'", value: 'apostrophe' },
                    { label: '°', value: 'degree' },
                  ]}
                  onChange={(value) => setNotation(value as OverbendNotation)}
                />
              </View>
              <View style={styles.propertiesCompactDropdownField}>
                <Dropdown
                  compact
                  label="Positions"
                  value={positionKeyFilter}
                  options={[
                    { label: '1st, 2nd, 3rd', value: '1-2-3' },
                    { label: '1st, 2nd, 3rd, 5th', value: '1-2-3-5' },
                    { label: 'All', value: 'all' },
                  ]}
                  onChange={(value) => setPositionKeyFilter(value as PositionKeyFilter)}
                />
              </View>
              <View style={styles.propertiesCompactDropdownField}>
                <Dropdown
                  compact
                  label="Harp keys"
                  value={harmonicaKeyLabelStyle}
                  options={[
                    { label: 'Standard', value: 'standard' },
                    { label: 'Flat', value: 'flat' },
                    { label: 'Sharp', value: 'sharp' },
                  ]}
                  onChange={(value) => setHarmonicaKeyLabelStyle(value as HarmonicaNoteLabelStyle)}
                />
              </View>
              <View style={styles.propertiesCompactDropdownField}>
                <Dropdown
                  compact
                  label="Target keys"
                  value={targetKeyLabelStyle}
                  options={[
                    { label: 'Flat', value: 'flat' },
                    { label: 'Sharp', value: 'sharp' },
                  ]}
                  onChange={(value) => setTargetKeyLabelStyle(value as NoteLabelStyle)}
                />
              </View>
            </View>
            <View style={styles.propertiesCompactDropdownRow}>
              <View style={styles.propertiesCompactDropdownField}>
                <Dropdown
                  compact
                  label="-2 / 3"
                  value={gAltPreference}
                  options={[
                    { label: '-2', value: '-2' },
                    { label: '3', value: '3' },
                  ]}
                  onChange={(value) => setGAltPreference(value as '-2' | '3')}
                />
              </View>
            </View>
            <View style={styles.propertiesRow}>
              <Pressable
                onPress={() => setShowDebug((prev) => !prev)}
                style={[styles.debugToggle, showDebug && styles.debugToggleActive]}
              >
                <Text style={styles.debugToggleText}>{showDebug ? 'Hide debug' : 'Show debug'}</Text>
              </Pressable>
            </View>
            {showDebug && Platform.OS !== 'web' && (
              <View style={styles.propertiesInlineFields}>
                <View style={styles.propertiesInlineField}>
                  <Text style={styles.dropdownLabel}>Frame interval (ms)</Text>
                  <TextInput
                    value={nativeFrameIntervalMsInput}
                    onChangeText={setNativeFrameIntervalMsInput}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    autoCorrect={false}
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder={String(DEFAULT_AUDIO_SETTINGS.nativeFrameIntervalMs)}
                    placeholderTextColor="#64748b"
                    style={styles.propertiesNumberInput}
                  />
                </View>
              </View>
            )}
            <Text style={styles.propertiesTitle}>Tone Follow</Text>
            <View style={styles.propertiesInlineFields}>
              <View style={styles.propertiesInlineField}>
                <Text style={styles.dropdownLabel}>Tolerance</Text>
                <TextInput
                  value={toneToleranceInput}
                  onChangeText={setToneToleranceInput}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  autoCorrect={false}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={DEFAULT_AUDIO_SETTINGS.toneToleranceInput}
                  placeholderTextColor="#64748b"
                  style={styles.propertiesNumberInput}
                />
              </View>
              <View style={styles.propertiesInlineField}>
                <Text style={styles.dropdownLabel}>Confidence</Text>
                <TextInput
                  value={toneFollowMinConfidenceInput}
                  onChangeText={setToneFollowMinConfidenceInput}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  autoCorrect={false}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={DEFAULT_AUDIO_SETTINGS.toneFollowMinConfidenceInput}
                  placeholderTextColor="#64748b"
                  style={styles.propertiesNumberInput}
                />
              </View>
            </View>
            <View style={styles.propertiesRow}>
              <Pressable onPress={() => setScreen('tab-symbols')} style={styles.debugToggle}>
                <Text style={styles.debugToggleText}>Tab symbols help</Text>
              </Pressable>
            </View>
          </View>
        ) : screen === 'tab-symbols' ? (
          <View style={styles.propertiesCard}>
            <Text style={styles.propertiesTitle}>Tab Symbols</Text>
            <Text style={styles.helperText}>Quick guide for reading tabs shown in this app.</Text>
            <View style={styles.symbolRow}>
              <Text style={styles.symbolKey}>4</Text>
              <Text style={styles.symbolMeaning}>Blow on hole 4.</Text>
            </View>
            <View style={styles.symbolRow}>
              <Text style={styles.symbolKey}>-4</Text>
              <Text style={styles.symbolMeaning}>Draw on hole 4.</Text>
            </View>
            <View style={styles.symbolRow}>
              <Text style={styles.symbolKey}>-4'</Text>
              <Text style={styles.symbolMeaning}>Draw bend (one semitone).</Text>
            </View>
            <View style={styles.symbolRow}>
              <Text style={styles.symbolKey}>-3''</Text>
              <Text style={styles.symbolMeaning}>Deeper bend (two semitones).</Text>
            </View>
            <View style={styles.symbolRow}>
              <Text style={styles.symbolKey}>4° / -7°</Text>
              <Text style={styles.symbolMeaning}>Overbend when Overbend Symbol is set to °.</Text>
            </View>
            <View style={styles.symbolRow}>
              <Text style={styles.symbolKey}>4' / -7'</Text>
              <Text style={styles.symbolMeaning}>Overbend when Overbend Symbol is set to '.</Text>
            </View>
          </View>
        ) : screen === 'tabs' ? (
          <>
            {tabsSubview === 'library' ? (
              <View style={[styles.propertiesCard, styles.libraryCard]}>
                <Text style={styles.propertiesTitle}>Saved Tabs</Text>
                <Text style={styles.helperText}>Manage reusable source tabs for the editor and transposer.</Text>
                <Pressable
                  testID="library-new-button"
                  onPress={() => openEditorForNewDraft('library')}
                  style={styles.libraryNewButton}
                >
                  <Text style={styles.savedTabActionText}>New Tab</Text>
                </Pressable>
                {savedTabsStatus && (
                  <Text style={[styles.savedTabsStatus, savedTabsStatusIsError && styles.savedTabsStatusError]}>
                    {savedTabsStatus}
                  </Text>
                )}
                {savedTabs.length === 0 ? (
                  <View style={styles.libraryListArea}>
                    <Text style={styles.helperText}>No saved tabs yet. Use New Tab to create one in the editor.</Text>
                  </View>
                ) : (
                  <ScrollView
                    testID="saved-tabs-scroll"
                    style={styles.libraryListArea}
                    contentContainerStyle={styles.savedTabsList}
                    keyboardShouldPersistTaps="handled"
                    nestedScrollEnabled
                  >
                    {savedTabs.map((tab) => (
                      <View key={tab.id} style={styles.savedTabRow}>
                        <View style={styles.savedTabRowHeader}>
                          <Text style={styles.savedTabTitle}>{tab.title}</Text>
                          {transposerSourceTabId === tab.id && <Text style={styles.savedTabActiveBadge}>Source</Text>}
                        </View>
                        <Text style={styles.savedTabPreview}>{formatSavedTabPreview(tab.inputText)}</Text>
                        <Text style={styles.savedTabMeta}>
                          {tab.harmonicaPc !== null && tab.positionNumber !== null
                            ? `${pcToNote(tab.harmonicaPc, harmonicaKeyPreferFlats)} harp • ${formatOrdinal(tab.positionNumber)} / ${pcToNote(getTargetRootPcForPosition(tab.harmonicaPc, tab.positionNumber), targetKeyPreferFlats)}  ·  `
                            : ''}
                          Updated {formatSavedTabTimestamp(tab.updatedAt)}
                        </Text>
                        <View style={styles.savedTabActions}>
                          <Pressable
                            testID={`saved-tab-open:${tab.id}`}
                            onPress={() => handleSavedTabOpenPress(tab)}
                            style={styles.savedTabActionButton}
                          >
                            <Text style={styles.savedTabActionText}>Open</Text>
                          </Pressable>
                          <Pressable
                            testID={`saved-tab-edit:${tab.id}`}
                            onPress={() => handleSavedTabEditPress(tab)}
                            style={styles.savedTabActionButton}
                          >
                            <Text style={styles.savedTabActionText}>Edit</Text>
                          </Pressable>
                          <Pressable
                            testID={`saved-tab-delete:${tab.id}`}
                            onPress={() => handleDeleteSavedTab(tab)}
                            style={[styles.savedTabActionButton, styles.savedTabDeleteButton]}
                          >
                            <Text style={[styles.savedTabActionText, styles.savedTabDeleteText]}>Delete</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>
            ) : (
              <TabsTransposeView
                isSmallScreen={isSmallScreen}
                transposerOutputMaxHeight={transposerOutputMaxHeight}
                transposerOutputTextStyle={transposerOutputTextStyle}
                harmonicaKey={harmonicaKey}
                harmonicaKeyDropdownOptions={harmonicaKeyDropdownOptions}
                onHarmonicaKeyChange={setHarmonicaKey}
                scaleRoot={scaleRoot}
                scaleKeyDropdownOptions={scaleKeyDropdownOptions}
                onScaleRootChange={(nextRoot) => {
                  setScaleRoot(nextRoot);
                  setTransposerOctaveOffset(0);
                }}
                transposerSourceTabId={transposerSourceTabId}
                onTransposerSourceTabChange={setTransposerSourceTabId}
                transposerOctaveOffset={transposerOctaveOffset}
                setTransposerOctaveOffset={setTransposerOctaveOffset}
                savedTabs={savedTabs}
                notation={notation}
                gAltPreference={gAltPreference}
                toneToleranceCents={toneToleranceCents}
                toneFollowMinConfidence={toneFollowMinConfidence}
                targetRootPc={scale.rootPc}
                firstPositionRoot={firstPositionRoot}
                setSavedTabsStatus={setSavedTabsStatus}
                setTabsSubview={setTabsSubview}
                openSavedTabInEditor={openSavedTabInEditor}
                openEditorForNewDraft={openEditorForNewDraft}
                showDebug={showDebug}
                simFrequency={simFrequency}
                setSimFrequency={setSimFrequency}
                onFollowStatusChange={setTransposerFollowStatus}
              />
            )}
          </>
        ) : (
          <ScalesWorkspace
            scalesLayout={scalesLayout}
            isSmallScreen={isSmallScreen}
            harmonicaKey={harmonicaKey}
            harmonicaKeyDropdownOptions={harmonicaKeyDropdownOptions}
            onHarmonicaKeyChange={setHarmonicaKey}
            scaleRoot={scaleRoot}
            scaleKeyDropdownOptions={scaleKeyDropdownOptions}
            onScaleRootChange={(nextRoot) => {
              setScaleRoot(nextRoot);
              setTransposerOctaveOffset(0);
            }}
            scaleId={scaleId}
            onScaleIdChange={setScaleId}
            scale={scale}
            groups={groups}
            selectedTabs={selectedTabs}
            arpeggioSections={arpeggioSections}
            arpeggioSelection={arpeggioSelection}
            onArpeggioSelectionChange={setArpeggioSelection}
            scaleNameDropdownOptions={scaleNameDropdownOptions}
            targetKeyPreferFlats={targetKeyPreferFlats}
            toneToleranceCents={toneToleranceCents}
            showDebug={showDebug}
            simFrequency={simFrequency}
            setSimFrequency={setSimFrequency}
            notation={notation}
            gAltPreference={gAltPreference}
            transposerFollowStatus={transposerFollowStatus}
          />
        )}
        {pendingContextOpenRecord !== null && pendingContextRecordContext !== null && pendingContextTargetPc !== null && (
          <View testID="saved-tab-context-modal" style={[StyleSheet.absoluteFill, styles.dialogOverlay]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setPendingContextOpenRecord(null)} />
            <View style={styles.dialogCard}>
              <Text style={styles.dialogTitle}>Saved tab context</Text>
              <Text style={styles.helperText}>
                "{pendingContextOpenRecord.title}" was saved with{' '}
                {pcToNote(pendingContextRecordContext.harmonicaPc, harmonicaKeyPreferFlats)} harp in{' '}
                {formatOrdinal(pendingContextRecordContext.positionNumber).toLowerCase()} position (
                {pcToNote(pendingContextTargetPc, targetKeyPreferFlats)}). Choose how to open it.
              </Text>
              <View style={styles.dialogActionColumn}>
                <Pressable onPress={() => setPendingContextOpenRecord(null)} style={styles.dialogButton}>
                  <Text style={styles.dialogButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  testID="saved-tab-context-use-saved-button"
                  onPress={() => {
                    applyHarpAndTargetSelection(
                      pendingContextRecordContext.harmonicaPc,
                      pendingContextRecordContext.positionNumber,
                    );
                    openSavedTabInTransposer(pendingContextOpenRecord);
                  }}
                  style={styles.dialogButton}
                >
                  <Text style={styles.dialogButtonText}>
                    Use saved: {pcToNote(pendingContextRecordContext.harmonicaPc, harmonicaKeyPreferFlats)} harp •{' '}
                    {formatPositionKeyLabel(
                      pendingContextRecordContext.positionNumber,
                      pendingContextTargetPc,
                      targetKeyPreferFlats,
                    )}
                  </Text>
                </Pressable>
                <Pressable
                  testID="saved-tab-context-keep-harp-button"
                  disabled={!pendingContextCurrentHarpVisible}
                  onPress={() => {
                    if (pendingContextCurrentHarpPosition === null) return;
                    applyHarpAndTargetSelection(harmonicaKey.pc, pendingContextCurrentHarpPosition);
                    openSavedTabInTransposer(pendingContextOpenRecord);
                  }}
                  style={[
                    styles.dialogButton,
                    !pendingContextCurrentHarpVisible && styles.dialogButtonDisabled,
                  ]}
                >
                  <Text
                    style={[
                      styles.dialogButtonText,
                      !pendingContextCurrentHarpVisible && styles.dialogButtonTextDisabled,
                    ]}
                  >
                    {pendingContextCurrentHarpVisible && pendingContextCurrentHarpPosition !== null
                      ? `Keep ${pcToNote(harmonicaKey.pc, harmonicaKeyPreferFlats)} harp: ${formatPositionKeyLabel(
                          pendingContextCurrentHarpPosition,
                          pendingContextTargetPc,
                          targetKeyPreferFlats,
                        )}`
                      : `Keep ${pcToNote(harmonicaKey.pc, harmonicaKeyPreferFlats)} harp: target key not available in visible positions`}
                  </Text>
                </Pressable>
                <Pressable
                  testID="saved-tab-context-keep-current-button"
                  onPress={() => openSavedTabInTransposer(pendingContextOpenRecord)}
                  style={[styles.dialogButton, styles.dialogPrimaryButton]}
                >
                  <Text style={[styles.dialogButtonText, styles.dialogPrimaryButtonText]}>
                    Keep current selection and load
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
        {showWorkspaceSwitcher && (
          <View style={styles.workspaceNavRow}>
            <Pressable
              testID="workspace-scales-button"
              onPress={() => {
                console.log('[press] workspace-scales-button', {
                  screen,
                  tabsSubview,
                  tabsEditorVisible,
                });
                setTabsEditorVisible(false);
                setScreen('scales');
              }}
              style={[styles.workspaceNavButton, screen === 'scales' && styles.workspaceNavButtonActive]}
            >
              <Text style={[styles.workspaceNavText, screen === 'scales' && styles.workspaceNavTextActive]}>Scales</Text>
            </Pressable>
            <Pressable
              testID="workspace-tabs-button"
              onPress={openTabsWorkspace}
              style={[styles.workspaceNavButton, screen === 'tabs' && !tabsEditorVisible && styles.workspaceNavButtonActive]}
            >
              <Text style={[styles.workspaceNavText, screen === 'tabs' && !tabsEditorVisible && styles.workspaceNavTextActive]}>
                Tabs
              </Text>
            </Pressable>
          </View>
        )}
      </>
    );
  }

  return (
    <AudioListeningProvider simHz={simHz} harmonicaPc={harmonicaKey.pc} nativeFrameIntervalMs={nativeFrameIntervalMs}>
      <SafeAreaView style={styles.safeArea}>
        {isTabsLibraryScreen || isScalesScreen ? (
          <View style={styles.staticContainer}>{renderMainContent()}</View>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.container, screen === 'scales' && scalesContainerStyle]}
            keyboardShouldPersistTaps="handled"
          >
            {renderMainContent()}
          </ScrollView>
        )}
        <Modal
          testID="editor-overlay-modal"
          visible={screen === 'tabs' && tabsEditorVisible}
          animationType="slide"
          onRequestClose={Platform.OS === 'android' ? handleEditorCloseRequest : undefined}
        >
          {renderEditorOverlay()}
        </Modal>
      </SafeAreaView>
    </AudioListeningProvider>
  );
}

function formatCents(value: number) {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value);
  if (rounded === 0) return '±0¢';
  return `${rounded > 0 ? '+' : ''}${rounded}¢`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#101418',
  },
  container: {
    padding: 20,
    gap: 12,
    flexGrow: 1,
  },
  staticContainer: {
    flex: 1,
    minHeight: 0,
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#f3f4f6',
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gearButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearButtonText: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '700',
  },
  editorDismissButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
  },
  editorDismissButtonText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  editorSaveAsButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
  },
  editorSaveAsButtonText: {
    color: '#7dd3fc',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  propertiesCard: {
    borderRadius: 12,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#182233',
    padding: 12,
    gap: 10,
  },
  libraryCard: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  propertiesTitle: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 14,
  },
  propertiesField: {
    gap: 6,
  },
  propertiesCompactDropdownRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 6,
  },
  propertiesCompactDropdownField: {
    flex: 1,
    minWidth: 0,
  },
  propertiesInlineFields: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  propertiesInlineField: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  propertiesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  propertiesLabel: {
    color: '#94a3b8',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#e5e7eb',
  },
  dropdown: {
    gap: 6,
  },
  dropdownCompact: {
    gap: 4,
  },
  dropdownLabel: {
    color: '#94a3b8',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  dropdownLabelCompact: {
    fontSize: 10,
    letterSpacing: 0.6,
  },
  dropdownLabelWide: {
    fontSize: 14,
  },
  propertiesNumberInput: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontFamily: 'Courier',
    fontSize: 13,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#0f172a',
  },
  dropdownTriggerCompact: {
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  dropdownTriggerWide: {
    minHeight: 52,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  dropdownTriggerOpen: {
    borderColor: '#38bdf8',
  },
  dropdownTriggerText: {
    color: '#e2e8f0',
    fontWeight: '600',
    flexShrink: 1,
  },
  dropdownTriggerTextCompact: {
    fontSize: 12,
  },
  dropdownTriggerTextWide: {
    fontSize: 16,
  },
  dropdownCaret: {
    color: '#94a3b8',
    fontWeight: '700',
    marginLeft: 6,
  },
  dropdownCaretCompact: {
    marginLeft: 4,
    fontSize: 11,
  },
  dropdownCaretWide: {
    marginLeft: 8,
    fontSize: 13,
  },
  dropdownMenu: {
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0b1220',
    borderRadius: 12,
    paddingVertical: 6,
  },
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 8, 14, 0.6)',
  },
  dropdownMenuOverlay: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0b1220',
    borderRadius: 12,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  dropdownItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  dropdownItemText: {
    color: '#e5e7eb',
    fontWeight: '600',
  },
  dropdownItemTextWide: {
    fontSize: 16,
  },
  toggleGroup: {
    gap: 6,
  },
  toggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  toggleItem: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#0b1220',
  },
  toggleItemWide: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  toggleItemSelected: {
    borderColor: '#38bdf8',
    backgroundColor: '#0f172a',
  },
  toggleItemText: {
    color: '#e2e8f0',
    fontWeight: '600',
    fontSize: 12,
  },
  toggleItemTextWide: {
    fontSize: 14,
  },
  toggleItemTextSelected: {
    color: '#f8fafc',
  },
  topRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'flex-end',
    gap: 12,
  },
  topRowKey: {
    flex: 1,
    minWidth: 0,
  },
  topRowToggle: {
    flex: 1,
    minWidth: 160,
  },
  workspaceNavRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 'auto',
    paddingTop: 8,
  },
  workspaceNavButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  workspaceNavButtonActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#0b3b4a',
  },
  workspaceNavText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  workspaceNavTextActive: {
    color: '#e0f2fe',
  },
  scalesWorkspaceShell: {
    flex: 1,
    minHeight: 0,
    width: '100%',
  },
  scalesWorkspace: {
    flex: 1,
    minHeight: 0,
    gap: 10,
  },
  pagerShell: {
    gap: 10,
  },
  pagerPage: {
    gap: 10,
  },
  pagerPageGrow: {
    flex: 1,
  },
  pageOneHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 12,
  },
  pagerDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 2,
    paddingTop: 2,
  },
  pagerDot: {
    minWidth: 118,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  pagerDotActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#38bdf8',
  },
  pagerDotText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
  },
  pagerDotTextActive: {
    color: '#082f49',
    fontWeight: '700',
  },
  scalePickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 2,
  },
  scalePickerColumn: {
    flex: 1,
    minWidth: 120,
    alignSelf: 'flex-start',
  },
  resultsList: {
    gap: 10,
  },
  scalesResultsScroll: {
    flex: 1,
    minHeight: 0,
  },
  resultRow: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#182233',
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 2,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  checkbox: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  resultTitle: {
    color: '#e2e8f0',
    fontWeight: '700',
    flex: 1,
    fontSize: 16,
  },
  resultTabs: {
    color: '#f8fafc',
    fontFamily: 'Courier',
    lineHeight: 20,
    fontSize: 14,
    position: 'relative',
    zIndex: 1,
  },
  resultTabsSmall: {
    fontSize: 12,
    lineHeight: 18,
  },
  resultTabsRoot: {
    fontWeight: '700',
    color: '#facc15',
    fontSize: 16,
  },
  helperText: {
    color: '#94a3b8',
  },
  listenCard: {
    borderRadius: 12,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#182233',
    gap: 6,
  },
  listenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  listenButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0f172a',
  },
  listenButtonActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#0b3b4a',
  },
  listenButtonDisabled: {
    borderColor: '#1f2937',
    backgroundColor: '#111827',
    opacity: 0.55,
  },
  listenButtonContent: {
    alignItems: 'center',
    gap: 2,
  },
  listenButtonTitle: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
  },
  listenButtonState: {
    color: '#cbd5e1',
    fontWeight: '700',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  listenButtonTextActive: {
    color: '#e0f2fe',
  },
  listenButtonTextDisabled: {
    color: '#94a3b8',
  },
  listenLabel: {
    color: '#94a3b8',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    width: 28,
  },
  debugToggle: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
  },
  debugToggleActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#0b3b4a',
  },
  debugToggleText: {
    color: '#e2e8f0',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  propertiesToggleButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
  },
  propertiesToggleButtonActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#0b3b4a',
  },
  propertiesToggleText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  symbolRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderColor: '#182233',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  symbolKey: {
    color: '#f8fafc',
    fontFamily: 'Courier',
    fontWeight: '700',
    width: 62,
  },
  symbolMeaning: {
    color: '#cbd5e1',
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  debugPanel: {
    paddingTop: 4,
    gap: 2,
  },
  debugPanelLabel: {
    color: '#64748b',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  debugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  debugLabel: {
    color: '#64748b',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    width: 54,
  },
  debugText: {
    color: '#94a3b8',
    fontSize: 11,
    fontFamily: 'Courier',
  },
  debugTextInline: {
    color: '#94a3b8',
    fontSize: 11,
    fontFamily: 'Courier',
  },
  debugInput: {
    minWidth: 80,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontWeight: '600',
    fontSize: 11,
  },
  listenInput: {
    flex: 0,
    minWidth: 90,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontWeight: '600',
  },
  listenValue: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  arpeggioSection: {
    marginTop: 4,
    gap: 6,
  },
  arpeggioBlock: {
    gap: 4,
  },
  arpeggioTitle: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 13,
  },
  arpeggioNote: {
    color: '#94a3b8',
    fontSize: 11,
  },
  arpeggioEmpty: {
    color: '#94a3b8',
    fontSize: 12,
  },
  arpeggioRow: {
    gap: 0,
  },
  arpeggioLabel: {
    color: '#e2e8f0',
    fontWeight: '600',
    fontSize: 12,
  },
  arpeggioNotesRoot: {
    color: '#facc15',
    fontWeight: '700',
  },
  arpeggioTabs: {
    color: '#f8fafc',
    fontSize: 12,
    fontFamily: 'Courier',
  },
  arpeggioTabList: {
    position: 'relative',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
  },
  arpeggioTabChip: {
    paddingVertical: 0,
    paddingHorizontal: 2,
    borderRadius: 6,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  arpeggioTabChipRoot: {
    borderColor: 'transparent',
  },
  arpeggioTabValue: {
    color: '#e2e8f0',
    fontSize: 11,
    fontFamily: 'Courier',
  },
  arpeggioTabValueRoot: {
    color: '#facc15',
    fontWeight: '700',
  },
  arpeggioTabsRoot: {
    color: '#facc15',
    fontWeight: '700',
  },
  tabGroupList: {
    position: 'relative',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  tabGroup: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1a2230',
    backgroundColor: '#121826',
  },
  tabGroupCompact: {
    paddingHorizontal: 0,
    gap: 4,
  },
  tabCaret: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(56, 189, 248, 0.45)',
    backgroundColor: 'rgba(56, 189, 248, 0.06)',
    zIndex: 3,
  },
  tabCaretInTune: {
    borderColor: '#16e05d',
    backgroundColor: 'rgba(22, 224, 93, 0.4)',
    shadowColor: '#16e05d',
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  transposerCard: {
    borderRadius: 12,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#182233',
    padding: 12,
    gap: 8,
  },
  transposerCardGrow: {
    flex: 1,
  },
  transposerTitle: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '700',
  },
  transposerMeta: {
    color: '#94a3b8',
    fontSize: 12,
  },
  transposerInput: {
    minHeight: 100,
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontFamily: 'Courier',
    fontSize: 13,
  },
  transposerInputGrow: {
    flex: 1,
  },
  editorPrimaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  editorPrimaryActionButton: {
    flex: 1,
    minWidth: 120,
  },
  editorSecondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  editorSecondaryActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    flex: 1,
  },
  editorSecondaryLabel: {
    color: '#94a3b8',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  editorSecondaryButton: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
  },
  editorSecondaryButtonCompact: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  editorSecondaryButtonText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  editorSecondaryButtonTextCompact: {
    fontSize: 10,
  },
  cleanInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  helpIconButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpIconText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: 'bold',
  },
  editorTitleInput: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
  editorContextCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editorContextCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorContextCheckboxChecked: {
    borderColor: '#38bdf8',
    backgroundColor: '#0b3b4a',
  },
  editorContextCheckmark: {
    color: '#38bdf8',
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
  },
  editorContextCheckboxLabel: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '600',
  },
  editorContextSelectors: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  dropdownDisabled: {
    opacity: 0.4,
  },
  savedTabsStatus: {
    color: '#93c5fd',
    fontSize: 12,
    lineHeight: 18,
  },
  savedTabsStatusError: {
    color: '#f87171',
  },
  transposerSectionLabel: {
    color: '#94a3b8',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  transposerSectionLabelCompact: {
    fontSize: 10,
    letterSpacing: 0.6,
    flexShrink: 0,
  },
  transposerFollowControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  transposerCurrentTab: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
  },
  transposerActionButton: {
    borderWidth: 1,
    borderColor: '#38bdf8',
    backgroundColor: '#0b3b4a',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  transposerActionButtonText: {
    color: '#e0f2fe',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  transposerActionButtonCompact: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 9,
    flexShrink: 0,
  },
  transposerActionButtonTextCompact: {
    fontSize: 10,
    letterSpacing: 0.6,
  },
  transposerLibraryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  transposerSourceCard: {
    gap: 6,
    borderWidth: 1,
    borderColor: '#182233',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  transposerEmptyState: {
    borderWidth: 1,
    borderColor: '#182233',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  transposerDirectionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  transposerDirectionRowCompact: {
    flexWrap: 'nowrap',
    gap: 6,
    justifyContent: 'space-between',
  },
  transposerDirectionOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  transposerDirectionOptionsCompact: {
    flexWrap: 'nowrap',
    flexShrink: 1,
    gap: 6,
  },
  transposerDirectionOption: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  transposerDirectionOptionCompact: {
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  transposerDirectionOptionActive: {
    borderColor: '#38bdf8',
  },
  transposerDirectionOptionDisabled: {
    opacity: 0.45,
  },
  transposerDirectionText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  transposerDirectionTextDisabled: {
    color: '#94a3b8',
  },
  transposerDirectionTextCompact: {
    fontSize: 11,
  },
  transposerOutputBox: {
    borderWidth: 1,
    borderColor: '#182233',
    borderRadius: 10,
    backgroundColor: '#0a101b',
    minHeight: 120,
  },
  transposerOutputBoxGrow: {
    flex: 1,
  },
  transposerOutputContent: {
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  transposerOutputText: {
    color: '#f8fafc',
    fontFamily: 'Courier',
    fontSize: 13,
    lineHeight: 20,
  },
  transposerOutputToken: {
    color: '#f8fafc',
    borderRadius: 999,
    paddingVertical: 1,
  },
  transposerOutputTokenActive: {
    borderWidth: 2,
    borderColor: 'rgba(56, 189, 248, 0.45)',
    // Border renders on web; on native (inline Text-in-Text) the border may not apply,
    // so background carries the visual weight. 25% opacity is visible on both platforms.
    backgroundColor: 'rgba(56, 189, 248, 0.25)',
  },
  transposerOutputTokenMatched: {
    borderColor: '#16e05d',
    backgroundColor: 'rgba(22, 224, 93, 0.4)',
    shadowColor: '#16e05d',
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  transposerOutputError: {
    color: '#ef4444',
    fontWeight: '700',
  },
  transposerWarnings: {
    gap: 4,
  },
  transposerWarningText: {
    color: '#fda4af',
    fontSize: 12,
  },
  savedTabsList: {
    gap: 10,
    paddingBottom: 4,
  },
  libraryListArea: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  libraryNewButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  savedTabRow: {
    gap: 8,
    borderWidth: 1,
    borderColor: '#182233',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  savedTabRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  savedTabTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  savedTabActiveBadge: {
    color: '#e0f2fe',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
    borderWidth: 1,
    borderColor: '#38bdf8',
    backgroundColor: '#0b3b4a',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  savedTabPreview: {
    color: '#cbd5e1',
    fontFamily: 'Courier',
    fontSize: 12,
    lineHeight: 18,
  },
  savedTabMeta: {
    color: '#94a3b8',
    fontSize: 11,
  },
  savedTabActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  savedTabActionButton: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  savedTabActionText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  savedTabDeleteButton: {
    borderColor: '#7f1d1d',
    backgroundColor: '#2a1117',
  },
  savedTabDeleteText: {
    color: '#fecdd3',
  },
  dialogOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(5, 8, 14, 0.55)',
  },
  dialogCard: {
    borderRadius: 16,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 16,
    gap: 12,
  },
  dialogTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
  },
  dialogInput: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    fontSize: 14,
  },
  dialogErrorText: {
    color: '#fda4af',
    fontSize: 12,
    fontWeight: '600',
  },
  dialogActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  dialogActionColumn: {
    gap: 8,
  },
  dialogButton: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#0f172a',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  dialogPrimaryButton: {
    borderColor: '#38bdf8',
    backgroundColor: '#0b3b4a',
  },
  dialogButtonDisabled: {
    opacity: 0.55,
  },
  dialogButtonText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  dialogButtonTextDisabled: {
    color: '#94a3b8',
  },
  dialogPrimaryButtonText: {
    color: '#e0f2fe',
  },
});
