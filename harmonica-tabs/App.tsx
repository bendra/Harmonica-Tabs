import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { HARMONICA_KEYS } from './src/data/keys';
import { SCALE_DEFINITIONS } from './src/data/scales';
import { normalizePc, noteToPc, pcToNote, NoteName } from './src/data/notes';
import { buildArpeggioSections } from './src/logic/arpeggios';
import { buildTabsForPcSet, buildTabsForScale, OverbendNotation, ScaleSelection, TabGroup } from './src/logic/tabs';
import { matchFrequencyToTabs, TabPitchMatch } from './src/logic/pitch';
import {
  resolveTransposerBaseShift,
  transposeTabTextAtShift,
} from './src/logic/transposer';
import {
  createTransposerFollowState,
  DetectorSnapshot,
  evaluateTransposerFollow,
  TransposerFollowState,
} from './src/logic/transposer-follow';
import {
  cleanupTransposerInput,
  normalizeTransposerEditInput,
  TextSelection,
} from './src/logic/transposer-input';
import {
  buildSavedTabTitleCandidate,
  createSavedTabLibraryService,
  formatSavedTabPreview,
  SavedTabRecord,
} from './src/logic/saved-tab-library';
import { createWebAudioPitchDetector } from './src/logic/web-audio';

/**
 * Human-readable label for the active scale selection.
 */
function formatScaleLabel(rootPc: number, scaleId: string, preferFlats: boolean): string {
  const scale = SCALE_DEFINITIONS.find((item) => item.id === scaleId);
  const rootName = pcToNote(rootPc, preferFlats);
  return `${rootName} ${scale ? scale.name : 'Scale'}`;
}

/**
 * Key option metadata derived from harmonica position playing.
 */
type ScaleKeyOption = {
  position: number;
  note: NoteName;
};

function formatOrdinal(value: number) {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

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

/**
 * Builds the 12 position-playing key options for the selected harmonica.
 */
function buildScaleKeyOptions(harmonicaPc: number, preferFlats: boolean): ScaleKeyOption[] {
  return Array.from({ length: 12 }, (_, index) => {
    const position = index + 1;
    const rootPc = (harmonicaPc + index * 7) % 12;
    return {
      position,
      note: pcToNote(rootPc, preferFlats),
    };
  });
}

type DropdownOption<T> = {
  label: string;
  value: T;
};

type LayoutTier = 'compact' | 'regular' | 'wide';
type ResponsiveControlSize = 'compact' | 'regular' | 'wide';

type SingleSelectOption<T extends string> = {
  label: string;
  value: T;
};

type PositionKeyFilter = '1-2-3' | '1-2-3-5' | 'all';
type AppScreen = 'scales' | 'tabs' | 'properties' | 'tab-symbols';
type SaveTabMode = 'overwrite' | 'create_new' | 'save_then_open' | 'save_then_close';
type TabsSubview = 'transpose' | 'library';
const AUDIO_SIGNAL_HOLD_MS = 400;
const AUDIO_CONFIDENCE_GATE = 0.2;
const TRANSPOSER_OUTPUT_SCROLL_PADDING = 16;
const savedTabLibraryService = createSavedTabLibraryService();

function sanitizeDecimalInput(value: string): string {
  let sawDot = false;
  let result = '';

  for (const char of value) {
    if (/[0-9]/.test(char)) {
      result += char;
      continue;
    }
    if (char === '.' && !sawDot) {
      sawDot = true;
      result += char;
    }
  }

  return result;
}

function parseBoundedNumber(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseBoundedInteger(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function formatSavedTabTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function getSaveDialogTitle(mode: SaveTabMode, hasLinkedRecord: boolean) {
  if (mode === 'create_new') return 'Save As New Tab';
  if (mode === 'save_then_open') return 'Save Then Open';
  if (mode === 'save_then_close') return 'Save Then Close';
  return hasLinkedRecord ? 'Update Saved Tab' : 'Save Tab';
}

function getSaveDialogConfirmLabel(mode: SaveTabMode) {
  if (mode === 'create_new') return 'Save As';
  if (mode === 'save_then_open') return 'Save Then Open';
  if (mode === 'save_then_close') return 'Save Then Close';
  return 'Save';
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
    <View style={[styles.dropdown, compact && styles.dropdownCompact]}>
      <Text style={[styles.dropdownLabel, compact && styles.dropdownLabelCompact, wide && styles.dropdownLabelWide]}>
        {props.label}
      </Text>
      <Pressable
        ref={triggerRef}
        onPress={() => (open ? setOpen(false) : openMenu())}
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
  const [harmonicaKey, setHarmonicaKey] = useState(HARMONICA_KEYS[0]);
  const [notation, setNotation] = useState<OverbendNotation>('apostrophe');
  const [positionKeyFilter, setPositionKeyFilter] = useState<PositionKeyFilter>('1-2-3');
  const [gAltPreference, setGAltPreference] = useState<'-2' | '3'>('-2');
  const [arpeggioSelection, setArpeggioSelection] = useState<'triads' | 'sevenths' | 'blues' | null>(null);
  const [scaleRoot, setScaleRoot] = useState<NoteName>('C');
  const [scaleId, setScaleId] = useState<string>(SCALE_DEFINITIONS[0].id);
  const [isListening, setIsListening] = useState(false);
  const [simFrequency, setSimFrequency] = useState('440');
  const [detectedFrequency, setDetectedFrequency] = useState<number | null>(null);
  const [detectedConfidence, setDetectedConfidence] = useState(0);
  const [detectedRms, setDetectedRms] = useState(0);
  const [lastDetectedAt, setLastDetectedAt] = useState<number | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [editorInput, setEditorInput] = useState('');
  const [editorSelection, setEditorSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [editorSavedTabId, setEditorSavedTabId] = useState<string | null>(null);
  const [editorReturnTo, setEditorReturnTo] = useState<TabsSubview>('library');
  const [transposerSourceTabId, setTransposerSourceTabId] = useState<string | null>(null);
  const [transposerOctaveOffset, setTransposerOctaveOffset] = useState(0);
  const [savedTabs, setSavedTabs] = useState<SavedTabRecord[]>([]);
  const [savedTabsStatus, setSavedTabsStatus] = useState<string | null>(null);
  const [saveTabModalVisible, setSaveTabModalVisible] = useState(false);
  const [saveTabMode, setSaveTabMode] = useState<SaveTabMode>('overwrite');
  const [saveTabTitleInput, setSaveTabTitleInput] = useState('');
  const [saveTabTitleError, setSaveTabTitleError] = useState<string | null>(null);
  const [pendingOpenRecord, setPendingOpenRecord] = useState<SavedTabRecord | null>(null);
  const [openAfterSaveRecordId, setOpenAfterSaveRecordId] = useState<string | null>(null);
  const [closeEditorModalVisible, setCloseEditorModalVisible] = useState(false);
  const [toneToleranceInput, setToneToleranceInput] = useState('60');
  const [toneFollowMinConfidenceInput, setToneFollowMinConfidenceInput] = useState('0.35');
  const [toneFollowHoldDurationInput, setToneFollowHoldDurationInput] = useState('400');
  const [listenError, setListenError] = useState<string | null>(null);
  const [listenSource, setListenSource] = useState<'web' | 'sim' | null>(null);
  const [transposerFollowState, setTransposerFollowState] = useState<TransposerFollowState>(
    createTransposerFollowState(null),
  );
  const [toneFollowTick, setToneFollowTick] = useState(0);
  const [transposerOutputViewportHeight, setTransposerOutputViewportHeight] = useState(0);
  const [transposerOutputTokenLayouts, setTransposerOutputTokenLayouts] = useState<
    Record<number, { y: number; height: number }>
  >({});
  const [tabLayouts, setTabLayouts] = useState<Array<{ x: number; y: number; width: number; height: number }>>([]);
  const [arpeggioLayouts, setArpeggioLayouts] = useState<
    Record<string, Array<{ x: number; y: number; width: number; height: number }>>
  >({});
  const [mainSelected, setMainSelected] = useState(true);
  const [arpeggioItemSelected, setArpeggioItemSelected] = useState<Record<string, boolean>>({});
  const transposerOutputScrollRef = useRef<ScrollView>(null);
  const transposerOutputScrollYRef = useRef(0);
  const editorInputRef = useRef<TextInput>(null);
  const detectorRef = useRef<ReturnType<typeof createWebAudioPitchDetector> | null>(null);
  const isMountedRef = useRef(true);
  const listenSessionRef = useRef(0);

  useEffect(() => {
    detectorRef.current = createWebAudioPitchDetector();
    return () => {
      isMountedRef.current = false;
      listenSessionRef.current += 1;
      detectorRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    savedTabLibraryService
      .listTabs()
      .then((tabs) => {
        if (cancelled) return;
        setSavedTabs(tabs);
      })
      .catch(() => {
        if (cancelled) return;
        setSavedTabsStatus('Saved tabs could not be loaded.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const scale = useMemo(
    () => ({ rootPc: noteToPc(scaleRoot), scaleId } satisfies ScaleSelection),
    [scaleRoot, scaleId],
  );

  const groups = useMemo(
    () => buildTabsForScale(scale, harmonicaKey.pc, notation),
    [scale, harmonicaKey.pc, notation],
  );

  const selectedTabs = useMemo(() => {
    return groups.map((group) => getPreferredTabOption(group));
  }, [groups, gAltPreference]);

  const arpeggioSections = useMemo(
    () =>
      buildArpeggioSections(
        scale.rootPc,
        scale.scaleId,
        arpeggioSelection ? [arpeggioSelection] : [],
      ),
    [scale, arpeggioSelection],
  );

  useEffect(() => {
    setTabLayouts([]);
    setArpeggioLayouts({});
  }, [scale.rootPc, scale.scaleId, harmonicaKey.label, notation, groups.length]);

  const scaleKeyOptions = useMemo(
    () => buildScaleKeyOptions(harmonicaKey.pc, harmonicaKey.preferFlats),
    [harmonicaKey.pc, harmonicaKey.preferFlats],
  );

  const visibleScaleKeyOptions = useMemo(() => {
    if (positionKeyFilter === 'all') return scaleKeyOptions;
    if (positionKeyFilter === '1-2-3') {
      return scaleKeyOptions.filter((option) => option.position <= 3);
    }
    return scaleKeyOptions.filter((option) => option.position <= 3 || option.position === 5);
  }, [scaleKeyOptions, positionKeyFilter]);

  const scaleKeyDropdownOptions = useMemo<DropdownOption<NoteName>[]>(
    () =>
      visibleScaleKeyOptions.map(({ position, note }) => ({
        label: `${formatOrdinal(position)} / ${note}`,
        value: note,
      })),
    [visibleScaleKeyOptions],
  );

  const scaleNameDropdownOptions = useMemo<DropdownOption<string>[]>(
    () => SCALE_DEFINITIONS.map((scale) => ({ label: scale.name, value: scale.id })),
    [],
  );
  const firstPositionRoot = useMemo(
    () => pcToNote(harmonicaKey.pc, harmonicaKey.preferFlats),
    [harmonicaKey.pc, harmonicaKey.preferFlats],
  );
  const transposerSourceTab = useMemo(
    () => savedTabs.find((tab) => tab.id === transposerSourceTabId) ?? null,
    [savedTabs, transposerSourceTabId],
  );

  const transposerSourceInput = transposerSourceTab?.inputText ?? '';
  const transposerBaseShift = useMemo(
    () =>
      resolveTransposerBaseShift({
        input: transposerSourceInput,
        sourceHarmonicaPc: harmonicaKey.pc,
        targetRootPc: scale.rootPc,
        notation,
        altPreference: gAltPreference,
      }),
    [transposerSourceInput, harmonicaKey.pc, scale.rootPc, notation, gAltPreference],
  );
  const transposerDisplayShift = transposerBaseShift.semitoneShift + transposerOctaveOffset * 12;
  const transposerResult = useMemo(
    () =>
      transposeTabTextAtShift({
        input: transposerSourceInput,
        sourceHarmonicaPc: harmonicaKey.pc,
        targetRootPc: scale.rootPc,
        notation,
        altPreference: gAltPreference,
        semitoneShift: transposerDisplayShift,
        baseSemitoneShift: transposerBaseShift.semitoneShift,
        baseAppliedDirection: transposerBaseShift.appliedDirection,
      }),
    [
      transposerSourceInput,
      harmonicaKey.pc,
      scale.rootPc,
      notation,
      gAltPreference,
      transposerDisplayShift,
      transposerBaseShift.semitoneShift,
      transposerBaseShift.appliedDirection,
    ],
  );
  const transposerNextDownResult = useMemo(
    () =>
      transposeTabTextAtShift({
        input: transposerSourceInput,
        sourceHarmonicaPc: harmonicaKey.pc,
        targetRootPc: scale.rootPc,
        notation,
        altPreference: gAltPreference,
        semitoneShift: transposerDisplayShift - 12,
        baseSemitoneShift: transposerBaseShift.semitoneShift,
        baseAppliedDirection: transposerBaseShift.appliedDirection,
      }),
    [
      transposerSourceInput,
      harmonicaKey.pc,
      scale.rootPc,
      notation,
      gAltPreference,
      transposerDisplayShift,
      transposerBaseShift.semitoneShift,
      transposerBaseShift.appliedDirection,
    ],
  );
  const transposerNextUpResult = useMemo(
    () =>
      transposeTabTextAtShift({
        input: transposerSourceInput,
        sourceHarmonicaPc: harmonicaKey.pc,
        targetRootPc: scale.rootPc,
        notation,
        altPreference: gAltPreference,
        semitoneShift: transposerDisplayShift + 12,
        baseSemitoneShift: transposerBaseShift.semitoneShift,
        baseAppliedDirection: transposerBaseShift.appliedDirection,
      }),
    [
      transposerSourceInput,
      harmonicaKey.pc,
      scale.rootPc,
      notation,
      gAltPreference,
      transposerDisplayShift,
      transposerBaseShift.semitoneShift,
      transposerBaseShift.appliedDirection,
    ],
  );
  const canStepTransposerDown = transposerSourceTab !== null && transposerNextDownResult.unavailableCount === 0;
  const canStepTransposerUp = transposerSourceTab !== null && transposerNextUpResult.unavailableCount === 0;
  const isTransposerBaseResetState =
    transposerSourceTab !== null && normalizePc(scale.rootPc - harmonicaKey.pc) === 0 && transposerOctaveOffset === 0;

  useEffect(() => {
    if (scaleKeyDropdownOptions.some((option) => option.value === scaleRoot)) return;
    const nextOption = scaleKeyDropdownOptions[0];
    if (nextOption) {
      setScaleRoot(nextOption.value);
    }
  }, [scaleKeyDropdownOptions, scaleRoot]);
  const editorSavedTab = useMemo(
    () => savedTabs.find((tab) => tab.id === editorSavedTabId) ?? null,
    [editorSavedTabId, savedTabs],
  );
  const savedTabsStatusIsError = isSavedTabsErrorStatus(savedTabsStatus);
  const hasUnsavedEditorChanges = editorSavedTab
    ? editorInput !== editorSavedTab.inputText
    : editorInput.trim().length > 0;
  const toneToleranceCents = useMemo(
    () => parseBoundedNumber(toneToleranceInput, 60, 1, 120),
    [toneToleranceInput],
  );
  const toneFollowMinConfidence = useMemo(
    () => parseBoundedNumber(toneFollowMinConfidenceInput, 0.35, 0, 1),
    [toneFollowMinConfidenceInput],
  );
  const toneFollowHoldDurationMs = useMemo(
    () => parseBoundedInteger(toneFollowHoldDurationInput, 400, 1, 5000),
    [toneFollowHoldDurationInput],
  );

  useEffect(() => {
    const nextActiveIndex = transposerResult.playableTokens.length > 0 ? 0 : null;
    setTransposerFollowState(createTransposerFollowState(nextActiveIndex));
    setTransposerOutputTokenLayouts({});
  }, [transposerResult.playableTokens]);

  useEffect(() => {
    setTransposerOctaveOffset(0);
  }, [transposerSourceTabId, harmonicaKey.pc, scale.rootPc]);

  useEffect(() => {
    if (!isListening || transposerResult.playableTokens.length === 0) return;
    const intervalId = setInterval(() => {
      setToneFollowTick((prev) => prev + 1);
    }, 50);

    return () => clearInterval(intervalId);
  }, [isListening, transposerResult.playableTokens.length]);

  function renderToneFollowDebugPanel() {
    return (
      <View style={styles.debugPanel}>
        <Text style={styles.debugPanelLabel}>Debug Panel</Text>
        <Text style={styles.debugText}>
          RMS: {detectedRms.toFixed(4)} · Conf: {detectedConfidence.toFixed(2)} · Hz:{' '}
          {detectedFrequency ? detectedFrequency.toFixed(1) : '—'}
        </Text>
        <Text style={styles.debugText}>
          Last detect: {lastDetectedAt ? `${now - lastDetectedAt}ms ago` : '—'} · Hold: {toneFollowHoldDurationMs}ms
        </Text>
        <View style={styles.debugRow}>
          <Text style={styles.debugLabel}>Source</Text>
          <Text style={styles.debugTextInline}>
            {listenSource === 'web'
              ? 'Mic input (web)'
              : listenSource === 'sim'
                ? 'Simulated Hz (fallback)'
                : '—'}
          </Text>
        </View>
        <View style={styles.debugRow}>
          <Text style={styles.debugLabel}>Sim Hz</Text>
          <TextInput
            value={simFrequency}
            onChangeText={setSimFrequency}
            keyboardType="numeric"
            style={styles.debugInput}
            placeholder="440"
            placeholderTextColor="#64748b"
          />
        </View>
      </View>
    );
  }

  /**
   * Applies the global -2/3 preference when both choices exist for a tab group.
   */
  function getPreferredTabOption(group: TabGroup) {
    const hasMinusTwo = group.options.some((token) => token.tab === '-2');
    const hasThree = group.options.some((token) => token.tab === '3');
    if (hasMinusTwo && hasThree) {
      return group.options.find((token) => token.tab === gAltPreference) ?? group.options[0];
    }
    return group.options[0];
  }

  /**
   * Renders an ordered note list with the root visually emphasized.
   */
  function formatNotes(pcs: number[], rootPc: number) {
    return pcs.map((pc, index) => (
      <Text key={`${pc}:${index}`} style={pc === rootPc ? styles.arpeggioNotesRoot : undefined}>
        {index === 0 ? pcToNote(pc, harmonicaKey.preferFlats) : `–${pcToNote(pc, harmonicaKey.preferFlats)}`}
      </Text>
    ));
  }

  function handleEditorInputChange(value: string) {
    setEditorInput(normalizeTransposerEditInput(value));
  }

  function handleCleanEditorInput() {
    const cleaned = cleanupTransposerInput(editorInput, {
      stripInvalidContent: true,
      removeExcessWhitespace: true,
    });
    setEditorInput(cleaned);
    setEditorSelection((prev) => ({
      start: Math.min(prev.start, cleaned.length),
      end: Math.min(prev.end, cleaned.length),
    }));
  }

  function closeSaveTabModal() {
    setSaveTabModalVisible(false);
    setSaveTabMode('overwrite');
    setSaveTabTitleInput('');
    setSaveTabTitleError(null);
    setOpenAfterSaveRecordId(null);
  }

  function resetEditorDialogState() {
    closeSaveTabModal();
    setCloseEditorModalVisible(false);
    setPendingOpenRecord(null);
  }

  function openSaveTabModal(mode: SaveTabMode = 'overwrite', nextOpenRecordId: string | null = null) {
    if (editorInput.trim().length === 0) {
      setSavedTabsStatus('Enter some tab text before saving.');
      return;
    }

    const defaultTitle = editorSavedTab?.title ?? buildSavedTabTitleCandidate(editorInput);

    setSaveTabMode(mode);
    setSaveTabTitleInput(defaultTitle);
    setSaveTabTitleError(null);
    setOpenAfterSaveRecordId(nextOpenRecordId);
    setSaveTabModalVisible(true);
    setSavedTabsStatus(null);
  }

  function startNewDraft() {
    setEditorInput('');
    setEditorSelection({ start: 0, end: 0 });
    setEditorSavedTabId(null);
    setPendingOpenRecord(null);
    setSavedTabsStatus('Started a new tab.');
    requestAnimationFrame(() => {
      editorInputRef.current?.focus();
    });
  }

  function finishClosingEditor() {
    resetEditorDialogState();
    setTabsEditorVisible(false);
    setTabsSubview(editorReturnTo);
  }

  function handleEditorCloseRequest() {
    if (hasUnsavedEditorChanges) {
      setCloseEditorModalVisible(true);
      return;
    }

    finishClosingEditor();
  }

  function openTabsWorkspace() {
    setTabsEditorVisible(false);
    setTabsSubview(transposerSourceTabId ? 'transpose' : 'library');
    setScreen('tabs');
  }

  function showTabsSubview(nextSubview: TabsSubview) {
    setTabsEditorVisible(false);
    setTabsSubview(nextSubview);
    setScreen('tabs');
  }

  function openSavedTabInEditor(record: SavedTabRecord, returnTo: TabsSubview = 'library') {
    setEditorInput(record.inputText);
    setEditorSelection({ start: 0, end: 0 });
    setEditorSavedTabId(record.id);
    setEditorReturnTo(returnTo);
    setPendingOpenRecord(null);
    setTabsSubview(returnTo);
    setTabsEditorVisible(true);
    setScreen('tabs');
    setSavedTabsStatus(`Opened "${record.title}" in the editor.`);
    requestAnimationFrame(() => {
      editorInputRef.current?.focus();
    });
  }

  function openEditorForNewDraft(returnTo: TabsSubview) {
    startNewDraft();
    setEditorReturnTo(returnTo);
    setTabsSubview(returnTo);
    setTabsEditorVisible(true);
    setScreen('tabs');
    setSavedTabsStatus(null);
  }

  async function handleSaveTabConfirm() {
    const nextTitle = saveTabTitleInput.trim();
    if (nextTitle.length === 0) {
      setSaveTabTitleError('Title is required.');
      return;
    }

    try {
      const nextSaveMode = saveTabMode;
      const nextOpenRecordId = openAfterSaveRecordId;
      const saveTargetId = nextSaveMode === 'create_new' ? null : editorSavedTabId;
      const result = await savedTabLibraryService.saveTab({
        id: saveTargetId,
        title: nextTitle,
        inputText: editorInput,
      });
      setSavedTabs(result.tabs);
      setEditorSavedTabId(result.savedTab.id);
      setSavedTabsStatus(`Saved "${result.savedTab.title}".`);
      closeSaveTabModal();

      if (nextSaveMode === 'save_then_close') {
        finishClosingEditor();
        return;
      }

      if (nextOpenRecordId) {
        const nextRecord = result.tabs.find((tab) => tab.id === nextOpenRecordId) ?? null;
        if (nextRecord) {
          openSavedTabInEditor(nextRecord, 'library');
        }
        return;
      }

      finishClosingEditor();
    } catch (error) {
      const nextMessage = error instanceof Error && error.message ? error.message : 'Could not save this tab.';
      setSaveTabTitleError(nextMessage);
    }
  }

  function handleSavedTabEditPress(record: SavedTabRecord) {
    if (!hasUnsavedEditorChanges) {
      openSavedTabInEditor(record, 'library');
      return;
    }

    const wouldReplaceCurrentInput = editorSavedTabId !== record.id || editorInput !== record.inputText;

    if (!wouldReplaceCurrentInput) {
      openSavedTabInEditor(record, 'library');
      return;
    }

    setPendingOpenRecord(record);
  }

  function handleSavedTabTransposePress(record: SavedTabRecord) {
    setTransposerSourceTabId(record.id);
    setSavedTabsStatus(`Selected "${record.title}" for transposing.`);
    setTabsEditorVisible(false);
    setTabsSubview('transpose');
    setScreen('tabs');
  }

  async function handleDeleteSavedTab(record: SavedTabRecord) {
    try {
      const nextTabs = await savedTabLibraryService.deleteTab(record.id);
      setSavedTabs(nextTabs);
      setPendingOpenRecord((prev) => (prev?.id === record.id ? null : prev));
      if (editorSavedTabId === record.id) {
        setEditorSavedTabId(null);
      }
      if (transposerSourceTabId === record.id) {
        setTransposerSourceTabId(null);
      }
      setSavedTabsStatus(`Deleted "${record.title}".`);
    } catch {
      setSavedTabsStatus('Could not delete that saved tab.');
    }
  }

  function moveTransposerCursor(tokenIndex: number) {
    setTransposerFollowState(createTransposerFollowState(tokenIndex));
  }

  function ensureActiveTransposerTokenVisible(params: {
    activeTokenIndex: number | null;
    layouts: Record<number, { y: number; height: number }>;
    scrollY: number;
    viewportHeight: number;
  }) {
    const { activeTokenIndex, layouts, scrollY, viewportHeight } = params;
    if (activeTokenIndex === null || viewportHeight <= 0) return null;

    const layout = layouts[activeTokenIndex];
    if (!layout) return null;

    const visibleTop = scrollY + TRANSPOSER_OUTPUT_SCROLL_PADDING;
    const visibleBottom = scrollY + viewportHeight - TRANSPOSER_OUTPUT_SCROLL_PADDING;
    const tokenTop = layout.y;
    const tokenBottom = layout.y + layout.height;

    if (tokenTop < visibleTop) {
      return Math.max(0, tokenTop - TRANSPOSER_OUTPUT_SCROLL_PADDING);
    }

    if (tokenBottom > visibleBottom) {
      return Math.max(0, tokenBottom - viewportHeight + TRANSPOSER_OUTPUT_SCROLL_PADDING);
    }

    return null;
  }

  const caretSize = 18;

  /**
   * Computes the caret position between neighboring tab elements from pitch match interpolation.
   */
  function getCaretPosition(
    match: TabPitchMatch | null,
    layouts: Array<{ x: number; y: number; width: number; height: number }>,
  ) {
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

  const parsedFrequency = Number.parseFloat(simFrequency);
  const simHz = Number.isFinite(parsedFrequency) ? parsedFrequency : null;
  const now = Date.now();
  const hasHold = lastDetectedAt !== null && now - lastDetectedAt < AUDIO_SIGNAL_HOLD_MS;
  const effectiveWebFrequency =
    detectedConfidence >= AUDIO_CONFIDENCE_GATE && detectedFrequency
      ? detectedFrequency
      : hasHold
        ? detectedFrequency
        : null;
  const audioSnapshot = useMemo<DetectorSnapshot>(
    () => ({
      frequency: !isListening ? null : listenSource === 'web' ? effectiveWebFrequency : simHz,
      confidence: !isListening ? 0 : listenSource === 'web' ? detectedConfidence : simHz ? 1 : 0,
      rms: detectedRms,
      source: isListening ? listenSource : null,
      lastDetectedAt,
    }),
    [detectedConfidence, detectedRms, effectiveWebFrequency, isListening, lastDetectedAt, listenSource, simHz],
  );
  const frequency = audioSnapshot.frequency;
  const midis = groups.map((group) => group.midi);
  const pitchMatch = isListening && frequency ? matchFrequencyToTabs(midis, frequency, 25) : null;
  const caretPos = mainSelected ? getCaretPosition(pitchMatch, tabLayouts) : null;
  const mainInTune = pitchMatch !== null && Math.abs(pitchMatch.centsOffset) <= toneToleranceCents;
  const activeTab = pitchMatch ? selectedTabs[pitchMatch.activeIndex] : null;
  const effectiveConfidence = audioSnapshot.confidence;
  const transposerFollowEvaluation = evaluateTransposerFollow({
    enabled: isListening,
    tokens: transposerResult.playableTokens,
    state: transposerFollowState,
    detector: audioSnapshot,
    toneToleranceCents,
    minConfidence: toneFollowMinConfidence,
    holdDurationMs: toneFollowHoldDurationMs,
    now: toneFollowTick > 0 ? Date.now() : now,
  });
  const statusText = isListening
    ? listenError
      ? listenError
      : activeTab && effectiveConfidence >= AUDIO_CONFIDENCE_GATE
        ? `${activeTab.tab} • ${frequency?.toFixed(1)} Hz ${pitchMatch ? formatCents(pitchMatch.centsOffset) : ''}`
        : 'No signal'
    : 'Off';
  const canListenOnTransposer = transposerSourceTab !== null && transposerResult.playableTokens.length > 0;
  const listenFeatureLabel = '🎤 Listen & Highlight Notes';
  const listenToggleStateLabel = `[${isListening ? 'On' : 'Off'}]`;
  const scalesContainerStyle = {
    padding: scalesLayout.containerPadding,
    gap: scalesLayout.workspaceGap,
  };
  const scalesWorkspaceShellStyle = [
    styles.scalesWorkspaceShell,
    scalesLayout.contentMaxWidth
      ? {
          maxWidth: scalesLayout.contentMaxWidth,
          alignSelf: 'center' as const,
        }
      : null,
  ];
  const scalesWorkspaceStyle = {
    gap: scalesLayout.workspaceGap,
  };
  const scalesTopRowStyle = {
    gap: scalesLayout.sectionGap,
  };
  const scalesPageHeaderStyle = {
    gap: scalesLayout.sectionGap,
  };
  const scalesListenCardStyle = {
    padding: scalesLayout.listenCardPadding,
    gap: Math.max(6, Math.round(scalesLayout.sectionGap / 2)),
  };
  const scalesListenRowStyle = {
    gap: Math.max(8, Math.round(scalesLayout.sectionGap / 1.5)),
  };
  const scalesListenButtonStyle = {
    minHeight: scalesLayout.listenButtonMinHeight || undefined,
    paddingVertical: scalesLayout.listenButtonPaddingVertical,
    paddingHorizontal: scalesLayout.listenButtonPaddingHorizontal,
  };
  const scalesListenButtonTitleStyle = {
    fontSize: scalesLayout.listenTitleFontSize,
  };
  const scalesListenButtonStateStyle = {
    fontSize: scalesLayout.listenStateFontSize,
  };
  const scalesListenValueStyle = {
    fontSize: scalesLayout.listenValueFontSize,
  };
  const scalesResultRowStyle = {
    padding: scalesLayout.cardPadding,
  };
  const scalesCheckboxStyle = {
    fontSize: scalesLayout.checkboxFontSize,
  };
  const scalesResultTitleStyle = {
    fontSize: scalesLayout.titleFontSize,
  };
  const scalesResultTabsStyle = {
    fontSize: scalesLayout.tabFontSize,
    lineHeight: scalesLayout.tabLineHeight,
  };
  const scalesResultTabsRootStyle = {
    fontSize: scalesLayout.tabRootFontSize,
  };
  const scalesTabGroupListStyle = {
    gap: scalesLayout.tabGap,
  };
  const scalesTabGroupStyle = {
    paddingVertical: scalesLayout.tabChipPaddingVertical,
    paddingHorizontal: scalesLayout.tabChipPaddingHorizontal,
  };
  const scalesArpeggioSectionStyle = {
    gap: Math.max(6, Math.round(scalesLayout.sectionGap / 2)),
  };
  const scalesArpeggioBlockStyle = {
    gap: Math.max(4, Math.round(scalesLayout.sectionGap / 3)),
  };
  const scalesArpeggioTitleStyle = {
    fontSize: scalesLayout.arpeggioTitleFontSize,
  };
  const scalesArpeggioNoteStyle = {
    fontSize: scalesLayout.arpeggioNoteFontSize,
  };
  const scalesArpeggioLabelStyle = {
    fontSize: scalesLayout.arpeggioLabelFontSize,
    lineHeight: Math.round(scalesLayout.arpeggioLabelFontSize * 1.45),
  };
  const scalesArpeggioTabsStyle = {
    fontSize: scalesLayout.arpeggioTabFontSize,
  };
  const scalesArpeggioTabListStyle = {
    gap: scalesLayout.arpeggioTabGap,
  };
  const scalesArpeggioTabChipStyle = {
    paddingHorizontal: scalesLayout.arpeggioTabPaddingHorizontal,
  };
  const scalesArpeggioTabValueStyle = {
    fontSize: scalesLayout.arpeggioTabFontSize,
  };
  const isScalesScreen = screen === 'scales' && !tabsEditorVisible;

  useEffect(() => {
    const nextState = transposerFollowEvaluation.state;
    if (
      nextState.activeTokenIndex === transposerFollowState.activeTokenIndex &&
      nextState.matchedSince === transposerFollowState.matchedSince &&
      nextState.waitingForRelease === transposerFollowState.waitingForRelease
    ) {
      return;
    }

    setTransposerFollowState(nextState);
  }, [transposerFollowEvaluation.state, transposerFollowState]);

  useEffect(() => {
    const nextScrollY = ensureActiveTransposerTokenVisible({
      activeTokenIndex: transposerFollowState.activeTokenIndex,
      layouts: transposerOutputTokenLayouts,
      scrollY: transposerOutputScrollYRef.current,
      viewportHeight: transposerOutputViewportHeight,
    });
    if (nextScrollY === null || nextScrollY === transposerOutputScrollYRef.current) return;

    transposerOutputScrollRef.current?.scrollTo({ y: nextScrollY, animated: true });
    transposerOutputScrollYRef.current = nextScrollY;
  }, [
    transposerFollowState.activeTokenIndex,
    transposerOutputTokenLayouts,
    transposerOutputViewportHeight,
  ]);

  /**
   * Starts microphone/sim listening and wires detector updates into state.
   */
  async function startListening() {
    const listenSession = listenSessionRef.current + 1;
    listenSessionRef.current = listenSession;
    setListenError(null);
    setDetectedFrequency(null);
    setDetectedConfidence(0);
    setDetectedRms(0);
    setLastDetectedAt(null);

    function isCurrentListenSession() {
      return isMountedRef.current && listenSessionRef.current === listenSession;
    }

    const detector = detectorRef.current;
    if (detector?.isSupported()) {
      try {
        await detector.start((update) => {
          if (!isCurrentListenSession()) return;
          setDetectedFrequency(update.frequency);
          setDetectedConfidence(update.confidence);
          setDetectedRms(update.rms);
          if (update.frequency && update.confidence >= AUDIO_CONFIDENCE_GATE) {
            setLastDetectedAt(Date.now());
          }
        });
        if (!isCurrentListenSession()) return;
        setListenSource('web');
      } catch (error) {
        if (!isCurrentListenSession()) return;
        setListenError('Mic blocked or unavailable (using sim)');
        setListenSource('sim');
      }
    } else {
      if (!isCurrentListenSession()) return;
      setListenError('Mic not supported in this browser (using sim)');
      setListenSource('sim');
    }

    if (!isCurrentListenSession()) return;
    setIsListening(true);
  }

  /**
   * Stops listening and clears detector-related state.
   */
  function stopListening() {
    listenSessionRef.current += 1;
    detectorRef.current?.stop();
    setIsListening(false);
    setListenSource(null);
    setDetectedFrequency(null);
    setDetectedConfidence(0);
    setDetectedRms(0);
    setLastDetectedAt(null);
  }

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
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <Text style={styles.title}>Tab Editor</Text>
          </View>
          <View style={[styles.transposerCard, styles.transposerCardGrow]}>
            <Text style={styles.transposerTitle}>
              {editorSavedTab ? `Editing: ${editorSavedTab.title}` : 'New Tab Draft'}
            </Text>
            <Text style={styles.transposerMeta}>
              Type or paste source tabs here. This is the only place raw tab text can be edited.
            </Text>
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
              <Pressable
                testID="editor-save-button"
                onPress={() => openSaveTabModal('overwrite')}
                style={[
                  styles.transposerActionButton,
                  styles.editorPrimaryActionButton,
                  isSmallScreen && styles.transposerActionButtonCompact,
                ]}
              >
                <Text
                  style={[
                    styles.transposerActionButtonText,
                    isSmallScreen && styles.transposerActionButtonTextCompact,
                  ]}
                >
                  {editorSavedTabId ? 'Re-save' : 'Save'}
                </Text>
              </Pressable>
              <Pressable
                testID="editor-save-as-button"
                onPress={() => openSaveTabModal('create_new')}
                style={[
                  styles.transposerActionButton,
                  styles.editorPrimaryActionButton,
                  isSmallScreen && styles.transposerActionButtonCompact,
                ]}
              >
                <Text
                  style={[
                    styles.transposerActionButtonText,
                    isSmallScreen && styles.transposerActionButtonTextCompact,
                  ]}
                >
                  Save As
                </Text>
              </Pressable>
            </View>
            <View style={styles.editorSecondaryRow}>
              <Text style={styles.editorSecondaryLabel}>Helpers</Text>
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
            </View>
            <TextInput
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
              placeholder="Paste or enter first-position tabs here, for example 4 -4 5 -5 6."
              placeholderTextColor="#64748b"
              textAlignVertical="top"
            />
          </View>
        </ScrollView>
      </SafeAreaView>
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
            <Text style={styles.propertiesTitle}>Tone Follow</Text>
            <View style={styles.propertiesInlineFields}>
              <View style={styles.propertiesInlineField}>
                <Text style={styles.dropdownLabel}>Tolerance</Text>
                <TextInput
                  value={toneToleranceInput}
                  onChangeText={(value) => setToneToleranceInput(sanitizeDecimalInput(value))}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  autoCorrect={false}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="10"
                  placeholderTextColor="#64748b"
                  style={styles.propertiesNumberInput}
                />
              </View>
              <View style={styles.propertiesInlineField}>
                <Text style={styles.dropdownLabel}>Confidence</Text>
                <TextInput
                  value={toneFollowMinConfidenceInput}
                  onChangeText={(value) => setToneFollowMinConfidenceInput(sanitizeDecimalInput(value))}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  autoCorrect={false}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="0.35"
                  placeholderTextColor="#64748b"
                  style={styles.propertiesNumberInput}
                />
              </View>
              <View style={styles.propertiesInlineField}>
                <Text style={styles.dropdownLabel}>Hold ms</Text>
                <TextInput
                  value={toneFollowHoldDurationInput}
                  onChangeText={(value) => setToneFollowHoldDurationInput(value.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  autoCorrect={false}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="400"
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
                        <Text style={styles.savedTabMeta}>Updated {formatSavedTabTimestamp(tab.updatedAt)}</Text>
                        <View style={styles.savedTabActions}>
                          <Pressable
                            testID={`saved-tab-open:${tab.id}`}
                            onPress={() => handleSavedTabTransposePress(tab)}
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
              <>
                <View style={styles.topRow}>
                  <View style={styles.topRowKey}>
                    <Dropdown
                      label="Harmonica key"
                      value={harmonicaKey.label}
                      options={HARMONICA_KEYS.map((key) => ({ label: key.label, value: key.label }))}
                      onChange={(label) => {
                        const key = HARMONICA_KEYS.find((item) => item.label === label);
                        if (key) setHarmonicaKey(key);
                      }}
                    />
                  </View>
                  <View style={styles.topRowKey}>
                    <Dropdown
                      label="Target Position/Key"
                      value={scaleRoot}
                      options={scaleKeyDropdownOptions}
                      onChange={(nextRoot) => {
                        setScaleRoot(nextRoot);
                        setTransposerOctaveOffset(0);
                      }}
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
                          startListening();
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
                          {listenFeatureLabel}
                        </Text>
                        <Text
                          style={[
                            styles.listenButtonState,
                            isListening && styles.listenButtonTextActive,
                            !canListenOnTransposer && !isListening && styles.listenButtonTextDisabled,
                          ]}
                        >
                          {listenToggleStateLabel}
                        </Text>
                      </View>
                    </Pressable>
                  </View>
                  {showDebug && renderToneFollowDebugPanel()}
                  <View style={styles.transposerLibraryRow}>
                    <Pressable
                      testID="transposer-choose-tab-button"
                      onPress={() => {
                        setSavedTabsStatus(null);
                        setTransposerSourceTabId(null);
                        setTabsSubview('library');
                      }}
                      style={[styles.transposerActionButton, isSmallScreen && styles.transposerActionButtonCompact]}
                    >
                      <Text
                        style={[
                          styles.transposerActionButtonText,
                          isSmallScreen && styles.transposerActionButtonTextCompact,
                        ]}
                      >
                        Choose Tab
                      </Text>
                    </Pressable>
                    <Pressable
                      testID="transposer-edit-tab-button"
                      onPress={() => {
                        if (transposerSourceTab) {
                          openSavedTabInEditor(transposerSourceTab, 'transpose');
                        } else {
                          openEditorForNewDraft('transpose');
                        }
                      }}
                      style={[styles.transposerActionButton, isSmallScreen && styles.transposerActionButtonCompact]}
                    >
                      <Text
                        style={[
                          styles.transposerActionButtonText,
                          isSmallScreen && styles.transposerActionButtonTextCompact,
                        ]}
                      >
                        {transposerSourceTab ? 'Edit Tab' : 'Create Tab'}
                      </Text>
                    </Pressable>
                  </View>
                  <Text style={styles.transposerCurrentTab}>
                    {transposerSourceTab ? `Current tab: ${transposerSourceTab.title}` : 'Current tab: none selected'}
                  </Text>
                  <View style={[styles.transposerDirectionRow, isSmallScreen && styles.transposerDirectionRowCompact]}>
                    <Text style={[styles.transposerSectionLabel, isSmallScreen && styles.transposerSectionLabelCompact]}>
                      Octave Shift
                    </Text>
                    <View
                      style={[
                        styles.transposerDirectionOptions,
                        isSmallScreen && styles.transposerDirectionOptionsCompact,
                      ]}
                    >
                      <Pressable
                        testID="transposer-octave-down-button"
                        disabled={!canStepTransposerDown}
                        onPress={() => {
                          if (!canStepTransposerDown) return;
                          setTransposerOctaveOffset((prev) => prev - 1);
                        }}
                        style={[
                          styles.transposerDirectionOption,
                          isSmallScreen && styles.transposerDirectionOptionCompact,
                          !canStepTransposerDown && styles.transposerDirectionOptionDisabled,
                        ]}
                      >
                        <Text
                          style={[
                            styles.transposerDirectionText,
                            isSmallScreen && styles.transposerDirectionTextCompact,
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
                          setScaleRoot(firstPositionRoot);
                          setTransposerOctaveOffset(0);
                        }}
                        style={[
                          styles.transposerDirectionOption,
                          isSmallScreen && styles.transposerDirectionOptionCompact,
                          isTransposerBaseResetState && styles.transposerDirectionOptionActive,
                          transposerSourceTab === null && styles.transposerDirectionOptionDisabled,
                        ]}
                      >
                        <Text
                          style={[
                            styles.transposerDirectionText,
                            isSmallScreen && styles.transposerDirectionTextCompact,
                            transposerSourceTab === null && styles.transposerDirectionTextDisabled,
                          ]}
                        >
                          Base
                        </Text>
                      </Pressable>
                      <Pressable
                        testID="transposer-octave-up-button"
                        disabled={!canStepTransposerUp}
                        onPress={() => {
                          if (!canStepTransposerUp) return;
                          setTransposerOctaveOffset((prev) => prev + 1);
                        }}
                        style={[
                          styles.transposerDirectionOption,
                          isSmallScreen && styles.transposerDirectionOptionCompact,
                          !canStepTransposerUp && styles.transposerDirectionOptionDisabled,
                        ]}
                      >
                        <Text
                          style={[
                            styles.transposerDirectionText,
                            isSmallScreen && styles.transposerDirectionTextCompact,
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
                      { maxHeight: transposerOutputMaxHeight },
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
                    <Text style={styles.transposerOutputText}>
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
            )}
          </>
        ) : (
          <View testID="scales-workspace-shell" style={scalesWorkspaceShellStyle}>
            <View testID="scales-workspace" style={[styles.scalesWorkspace, scalesWorkspaceStyle]}>
            <View style={[styles.topRow, scalesTopRowStyle]}>
              <View style={styles.topRowKey}>
                <Dropdown
                  label="Harmonica key"
                  value={harmonicaKey.label}
                  size={scalesLayout.controlSize}
                  options={HARMONICA_KEYS.map((key) => ({ label: key.label, value: key.label }))}
                  onChange={(label) => {
                    const key = HARMONICA_KEYS.find((item) => item.label === label);
                    if (key) setHarmonicaKey(key);
                  }}
                />
              </View>
              <View style={styles.topRowKey}>
                <Dropdown
                  label="Target Position/Key"
                  value={scaleRoot}
                  size={scalesLayout.controlSize}
                  options={scaleKeyDropdownOptions}
                  onChange={(nextRoot) => {
                    setScaleRoot(nextRoot);
                    setTransposerOctaveOffset(0);
                  }}
                />
              </View>
            </View>

            <View style={[styles.pageOneHeader, scalesPageHeaderStyle]}>
              <View style={styles.scalePickerColumn}>
                <Dropdown
                  label="Scale Name"
                  value={scaleId}
                  size={scalesLayout.controlSize}
                  options={scaleNameDropdownOptions}
                  onChange={setScaleId}
                />
              </View>
              <View style={styles.topRowToggle}>
                <SingleSelectGroup
                  label="Arpeggios"
                  size={scalesLayout.controlSize}
                  value={arpeggioSelection}
                  options={[
                    { label: 'Triads', value: 'triads' },
                    { label: '7th', value: 'sevenths' },
                    { label: 'Blues', value: 'blues' },
                  ]}
                  onChange={setArpeggioSelection}
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
                      startListening();
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
                      {listenFeatureLabel}
                    </Text>
                    <Text
                      style={[
                        styles.listenButtonState,
                        scalesListenButtonStateStyle,
                        isListening && styles.listenButtonTextActive,
                      ]}
                    >
                      {listenToggleStateLabel}
                    </Text>
                  </View>
                </Pressable>
                <Text style={[styles.listenValue, scalesListenValueStyle]}>{statusText}</Text>
              </View>
              {showDebug && renderToneFollowDebugPanel()}
            </View>

            <ScrollView
              testID="scales-results-scroll"
              style={styles.scalesResultsScroll}
              contentContainerStyle={styles.resultsList}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              <View key={`result:${scale.rootPc}:${scale.scaleId}`} style={[styles.resultRow, scalesResultRowStyle]}>
                <Pressable onPress={() => setMainSelected((prev) => !prev)} style={styles.resultHeader}>
                  <View style={styles.checkboxRow}>
                    <Text style={[styles.checkbox, scalesCheckboxStyle]}>{mainSelected ? '☑' : '☐'}</Text>
                    <Text style={[styles.resultTitle, scalesResultTitleStyle]}>
                      {formatScaleLabel(scale.rootPc, scale.scaleId, harmonicaKey.preferFlats)}
                    </Text>
                  </View>
                </Pressable>
                {!mainSelected ? null : groups.length === 0 ? (
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
                    {groups.map((group, index) => {
                      const option = selectedTabs[index];
                      return (
                        <Pressable
                          key={`${scale.rootPc}:${scale.scaleId}:${group.midi}`}
                          testID={`main-tab-group:${index}`}
                          onLayout={(event) => {
                            const { x, y, width, height } = event.nativeEvent.layout;
                            setTabLayouts((prev) => {
                              const next = [...prev];
                              next[index] = { x, y, width, height };
                              return next;
                            });
                          }}
                          onPress={() => {
                            setMainSelected((prev) => !prev);
                          }}
                          style={[styles.tabGroup, scalesTabGroupStyle, isSmallScreen && styles.tabGroupCompact]}
                        >
                          <Text
                            style={[
                              styles.resultTabs,
                              scalesResultTabsStyle,
                              isSmallScreen && styles.resultTabsSmall,
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
                {arpeggioSections.length > 0 && (
                  <View style={[styles.arpeggioSection, scalesArpeggioSectionStyle]}>
                    {arpeggioSections.map((section) => (
                      <View key={`arp:${section.id}`} style={[styles.arpeggioBlock, scalesArpeggioBlockStyle]}>
                        <Text style={[styles.arpeggioTitle, scalesArpeggioTitleStyle]}>{section.title}</Text>
                        {section.note && <Text style={[styles.arpeggioNote, scalesArpeggioNoteStyle]}>{section.note}</Text>}
                        {section.items.length === 0 ? (
                          <Text style={[styles.arpeggioEmpty, scalesArpeggioTabsStyle]}>{section.emptyNote ?? 'None'}</Text>
                        ) : (
                          section.items.map((item) => {
                            const tabGroups = buildTabsForPcSet(item.pcs, item.rootPc, harmonicaKey.pc, notation);
                            const tabTokens = tabGroups
                              .map((group) => {
                                const option = getPreferredTabOption(group);
                                return option
                                  ? {
                                      tab: option.tab,
                                      isRoot: group.isRoot,
                                      midi: group.midi,
                                    }
                                  : null;
                              })
                              .filter(Boolean) as Array<{
                              tab: string;
                              isRoot: boolean;
                              midi: number;
                            }>;
                            const rowSelected = arpeggioItemSelected[item.id] ?? false;
                            const rowMatch =
                              isListening && frequency && rowSelected
                                ? matchFrequencyToTabs(
                                    tabTokens.map((token) => token.midi),
                                    frequency,
                                    25,
                                  )
                                : null;
                            const rowCaretPos = rowSelected
                              ? getCaretPosition(rowMatch, arpeggioLayouts[item.id] ?? [])
                              : null;
                            const rowInTune =
                              rowMatch !== null && Math.abs(rowMatch.centsOffset) <= toneToleranceCents;
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
                                    {item.label} · {formatNotes(item.orderedPcs, item.rootPc)}
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
                                            {
                                              left: rowCaretPos.left,
                                              top: rowCaretPos.top,
                                              width: caretSize,
                                              height: caretSize,
                                            },
                                          ]}
                                        />
                                      )}
                                      {tabTokens.map((token, index) => (
                                        <View
                                          key={`${item.id}:tab:${index}`}
                                          onLayout={(event) => {
                                            const { x, y, width, height } = event.nativeEvent.layout;
                                            setArpeggioLayouts((prev) => {
                                              const next = { ...prev };
                                              const row = [...(next[item.id] ?? [])];
                                              row[index] = { x, y, width, height };
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
        )}
        {showWorkspaceSwitcher && (
          <View style={styles.workspaceNavRow}>
            <Pressable
              testID="workspace-scales-button"
              onPress={() => {
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
        onRequestClose={handleEditorCloseRequest}
      >
        {renderEditorOverlay()}
      </Modal>
      <Modal transparent visible={saveTabModalVisible} animationType="fade" onRequestClose={closeSaveTabModal}>
          <View testID="save-tab-modal" style={styles.dialogOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeSaveTabModal} />
            <View style={styles.dialogCard}>
              <Text style={styles.dialogTitle}>{getSaveDialogTitle(saveTabMode, editorSavedTab !== null)}</Text>
              <Text style={styles.helperText}>Titles help users find a saved tab later.</Text>
              <TextInput
                testID="save-tab-title-input"
                value={saveTabTitleInput}
                onChangeText={(value) => {
                  setSaveTabTitleInput(value);
                  if (saveTabTitleError) {
                    setSaveTabTitleError(null);
                  }
                }}
                style={styles.dialogInput}
                placeholder="Saved tab title"
                placeholderTextColor="#64748b"
                autoCorrect={false}
                autoCapitalize="sentences"
                spellCheck={false}
              />
              {saveTabTitleError && <Text style={styles.dialogErrorText}>{saveTabTitleError}</Text>}
              <View style={styles.dialogActionRow}>
                <Pressable onPress={closeSaveTabModal} style={styles.dialogButton}>
                  <Text style={styles.dialogButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  testID="save-tab-confirm-button"
                  onPress={handleSaveTabConfirm}
                  style={[styles.dialogButton, styles.dialogPrimaryButton]}
                >
                  <Text style={[styles.dialogButtonText, styles.dialogPrimaryButtonText]}>
                    {getSaveDialogConfirmLabel(saveTabMode)}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
      </Modal>
      <Modal
        testID="pending-open-modal"
        transparent
        visible={pendingOpenRecord !== null}
        animationType="fade"
        onRequestClose={() => setPendingOpenRecord(null)}
      >
        <View style={styles.dialogOverlay}>
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
                  openSaveTabModal('save_then_open', pendingOpenRecord.id);
                  setPendingOpenRecord(null);
                }}
                style={[styles.dialogButton, styles.dialogPrimaryButton]}
              >
                <Text style={[styles.dialogButtonText, styles.dialogPrimaryButtonText]}>Save Then Open</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        testID="editor-close-confirm-modal"
        transparent
        visible={closeEditorModalVisible}
        animationType="fade"
        onRequestClose={() => setCloseEditorModalVisible(false)}
      >
        <View style={styles.dialogOverlay}>
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
                  openSaveTabModal('save_then_close');
                  setCloseEditorModalVisible(false);
                }}
                style={[styles.dialogButton, styles.dialogPrimaryButton]}
              >
                <Text style={[styles.dialogButtonText, styles.dialogPrimaryButtonText]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
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
    color: '#e2e8f0',
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
    backgroundColor: 'rgba(56, 189, 248, 0.06)',
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
  dialogButtonText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  dialogPrimaryButtonText: {
    color: '#e0f2fe',
  },
});
