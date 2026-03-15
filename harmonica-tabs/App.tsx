import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
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
import { noteToPc, pcToNote, NoteName } from './src/data/notes';
import { buildArpeggioSections } from './src/logic/arpeggios';
import { buildTabsForPcSet, buildTabsForScale, OverbendNotation, ScaleSelection, TabGroup } from './src/logic/tabs';
import { matchFrequencyToTabs, TabPitchMatch } from './src/logic/pitch';
import { transposeTabText } from './src/logic/transposer';
import {
  createTransposerFollowState,
  DetectorSnapshot,
  evaluateTransposerFollow,
  TransposerFollowState,
} from './src/logic/transposer-follow';
import {
  cleanupTransposerInput,
  deleteBackwardAtSelection,
  insertAtSelection,
  insertTokenAtSelection,
  normalizeTransposerEditInput,
  TextSelection,
  TransposerCleanupOptions,
  TransposerTokenSign,
  TransposerTokenSuffix,
} from './src/logic/transposer-input';
import {
  detectTransposerInputMode,
  readWebTransposerInputSignals,
  TransposerInputMode,
} from './src/logic/transposer-input-mode';
import { readClipboardText } from './src/logic/transposer-clipboard';
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

type SingleSelectOption<T extends string> = {
  label: string;
  value: T;
};

type PositionKeyFilter = '1-2-3' | '1-2-3-5' | 'all';
type TabPadSignOption = {
  label: string;
  value: TransposerTokenSign;
};

type TabPadSuffixOption = {
  label: string;
  value: TransposerTokenSuffix;
};

const TAB_PAD_SIGN_OPTIONS: TabPadSignOption[] = [
  { label: 'Plain', value: '' },
  { label: 'Draw -', value: '-' },
  { label: 'Blow +', value: '+' },
];

const TAB_PAD_SUFFIX_OPTIONS: TabPadSuffixOption[] = [
  { label: 'Straight', value: '' },
  { label: "'", value: "'" },
  { label: "''", value: "''" },
  { label: "'''", value: "'''" },
  { label: '°', value: '°' },
];

const TAB_PAD_HOLES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
const AUDIO_SIGNAL_HOLD_MS = 400;
const AUDIO_CONFIDENCE_GATE = 0.2;
const TRANSPOSER_OUTPUT_SCROLL_PADDING = 16;

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

function formatToneFollowStatus(params: {
  isListening: boolean;
  currentTokenText: string | null;
  status: 'idle' | 'listening' | 'holding' | 'advanced' | 'waiting-for-release' | 'no-match';
  centsOffset: number | null;
}): string {
  const { centsOffset, currentTokenText, isListening, status } = params;
  const targetLabel = currentTokenText ? `Target ${currentTokenText}` : 'No target';

  if (!isListening) {
    return `${targetLabel} • Listening off`;
  }

  if (status === 'holding') {
    return `${targetLabel} • Holding${centsOffset === null ? '' : ` ${formatCents(centsOffset)}`}`;
  }

  if (status === 'advanced') {
    return `${targetLabel} • Advanced`;
  }

  if (status === 'waiting-for-release') {
    return `${targetLabel} • Release note before the next match`;
  }

  if (status === 'no-match') {
    return `${targetLabel} • Waiting for match${centsOffset === null ? '' : ` ${formatCents(centsOffset)}`}`;
  }

  if (status === 'listening') {
    return `${targetLabel} • Listening`;
  }

  return `${targetLabel} • Idle`;
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
}) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [menuLayout, setMenuLayout] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const triggerRef = useRef<View>(null);
  const active = props.options.find((opt) => opt.value === props.value);

  function openMenu() {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setMenuLayout({ x, y, width, height });
      setOpen(true);
    });
  }

  return (
    <View style={[styles.dropdown, props.compact && styles.dropdownCompact]}>
      <Text style={[styles.dropdownLabel, props.compact && styles.dropdownLabelCompact]}>{props.label}</Text>
      <Pressable
        ref={triggerRef}
        onPress={() => (open ? setOpen(false) : openMenu())}
        style={[
          styles.dropdownTrigger,
          props.compact && styles.dropdownTriggerCompact,
          open && styles.dropdownTriggerOpen,
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.dropdownTriggerText, props.compact && styles.dropdownTriggerTextCompact]}
        >
          {active?.label ?? 'Select'}
        </Text>
        <Text style={[styles.dropdownCaret, props.compact && styles.dropdownCaretCompact]}>{open ? '▲' : '▼'}</Text>
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
                  <Text style={styles.dropdownItemText}>{option.label}</Text>
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
}) {
  return (
    <View style={styles.toggleGroup}>
      <Text style={styles.dropdownLabel}>{props.label}</Text>
      <View style={styles.toggleRow}>
        {props.options.map((option) => {
          const selected = props.value === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => props.onChange(selected ? null : option.value)}
              style={[styles.toggleItem, selected && styles.toggleItemSelected]}
            >
              <Text style={[styles.toggleItemText, selected && styles.toggleItemTextSelected]}>
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
  const isSmallScreen = Math.min(width, height) < 420;
  const isActEnvironment =
    typeof globalThis !== 'undefined' && Boolean((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT);
  const [screen, setScreen] = useState<'main' | 'properties' | 'tab-symbols'>('main');
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
  const [pagerIndex, setPagerIndex] = useState(0);
  const [transposerInput, setTransposerInput] = useState('');
  const [transposerSelection, setTransposerSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [transposerDirection, setTransposerDirection] = useState<'up' | 'down'>('down');
  const [transposerPadVisible, setTransposerPadVisible] = useState(false);
  const [transposerPadDebugEvents, setTransposerPadDebugEvents] = useState<string[]>([]);
  const [transposerPadSign, setTransposerPadSign] = useState<TransposerTokenSign>('');
  const [transposerPadSuffix, setTransposerPadSuffix] = useState<TransposerTokenSuffix>('');
  const [transposerPasteStatus, setTransposerPasteStatus] = useState<string | null>(null);
  const [transposerKeyboardPreference, setTransposerKeyboardPreference] = useState<'custom' | 'native' | null>('native');
  const [toneToleranceInput, setToneToleranceInput] = useState('60');
  const [toneFollowMinConfidenceInput, setToneFollowMinConfidenceInput] = useState('0.35');
  const [toneFollowHoldDurationInput, setToneFollowHoldDurationInput] = useState('400');
  const [stripInvalidTransposerContent, setStripInvalidTransposerContent] = useState(true);
  const [removeExcessTransposerWhitespace, setRemoveExcessTransposerWhitespace] = useState(true);
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
  const pagerRef = useRef<ScrollView>(null);
  const transposerOutputScrollRef = useRef<ScrollView>(null);
  const transposerOutputScrollYRef = useRef(0);
  const transposerInputRef = useRef<TextInput>(null);
  const detectorRef = useRef<ReturnType<typeof createWebAudioPitchDetector> | null>(null);
  const transposerPadDismissInProgressRef = useRef(false);

  useEffect(() => {
    detectorRef.current = createWebAudioPitchDetector();
    return () => {
      detectorRef.current?.stop();
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
    () => visibleScaleKeyOptions.map(({ position, note }) => ({ label: `${position} - ${note}`, value: note })),
    [visibleScaleKeyOptions],
  );

  const scaleNameDropdownOptions = useMemo<DropdownOption<string>[]>(
    () => SCALE_DEFINITIONS.map((scale) => ({ label: scale.name, value: scale.id })),
    [],
  );
  const pageWidth = Math.max(width - 40, 280);
  const transposerOutputMaxHeight = Math.max(160, Math.min(Math.floor(height * 0.32), 280));
  const targetPosition = scaleKeyOptions.find((option) => option.note === scaleRoot)?.position ?? 1;

  const transposerDownResult = useMemo(
    () =>
      transposeTabText({
        input: transposerInput,
        sourceHarmonicaPc: harmonicaKey.pc,
        targetRootPc: scale.rootPc,
        notation,
        altPreference: gAltPreference,
        direction: 'down',
      }),
    [transposerInput, harmonicaKey.pc, scale.rootPc, notation, gAltPreference],
  );
  const transposerUpResult = useMemo(
    () =>
      transposeTabText({
        input: transposerInput,
        sourceHarmonicaPc: harmonicaKey.pc,
        targetRootPc: scale.rootPc,
        notation,
        altPreference: gAltPreference,
        direction: 'up',
      }),
    [transposerInput, harmonicaKey.pc, scale.rootPc, notation, gAltPreference],
  );
  const defaultDirection: 'up' | 'down' =
    transposerDownResult.unavailableCount === 0
      ? 'down'
      : transposerUpResult.unavailableCount === 0
        ? 'up'
        : 'down';

  useEffect(() => {
    if (scaleKeyDropdownOptions.some((option) => option.value === scaleRoot)) return;
    const nextOption = scaleKeyDropdownOptions[0];
    if (nextOption) {
      setScaleRoot(nextOption.value);
    }
  }, [scaleKeyDropdownOptions, scaleRoot]);
  const transposerResult = transposerDirection === 'down' ? transposerDownResult : transposerUpResult;
  const pagerTabs = [
    { page: 0 as const, label: 'Visualizer' },
    { page: 1 as const, label: 'Transposer' },
  ];
  const transposerInputDetection = useMemo(() => {
    const runtimeSignals =
      Platform.OS === 'web'
        ? readWebTransposerInputSignals()
        : { coarsePointerMediaMatches: false, maxTouchPoints: 0 };

    return detectTransposerInputMode({
      platformOs: Platform.OS,
      viewportWidth: width,
      viewportHeight: height,
      coarsePointerMediaMatches: runtimeSignals.coarsePointerMediaMatches,
      maxTouchPoints: runtimeSignals.maxTouchPoints,
    });
  }, [width, height]);
  const effectiveTransposerInputMode =
    transposerKeyboardPreference === 'custom'
      ? 'pad'
      : transposerKeyboardPreference === 'native'
        ? 'native'
        : transposerInputDetection.defaultMode;
  const useCustomTransposerPad = effectiveTransposerInputMode === 'pad';
  const shouldConsoleLogTransposerPadDebug = Platform.OS === 'web' && !isActEnvironment;
  const transposerCleanupOptions = useMemo<TransposerCleanupOptions>(
    () => ({
      stripInvalidContent: stripInvalidTransposerContent,
      removeExcessWhitespace: removeExcessTransposerWhitespace,
    }),
    [stripInvalidTransposerContent, removeExcessTransposerWhitespace],
  );
  const toneToleranceCents = useMemo(
    () => parseBoundedNumber(toneToleranceInput, 60, 1, 
      
    ),
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
    setTransposerDirection(defaultDirection);
  }, [defaultDirection]);

  useEffect(() => {
    if (!isListening || transposerResult.playableTokens.length === 0) return;
    const intervalId = setInterval(() => {
      setToneFollowTick((prev) => prev + 1);
    }, 50);

    return () => clearInterval(intervalId);
  }, [isListening, transposerResult.playableTokens.length]);

  /**
   * Keeps the pager's visible page aligned with the saved page index.
   */
  function scrollToPagerPage(page: number, animated: boolean) {
    pagerRef.current?.scrollTo({ x: page * pageWidth, animated });
  }

  useEffect(() => {
    if (screen !== 'main') return;
    const frameId = requestAnimationFrame(() => {
      scrollToPagerPage(pagerIndex, false);
    });
    return () => cancelAnimationFrame(frameId);
  }, [screen, pageWidth]);

  useEffect(() => {
    if (screen === 'main' && pagerIndex === 1) return;
    setTransposerPadVisibleWithDebug(false, 'leave-transposer-page');
  }, [pagerIndex, screen]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (useCustomTransposerPad) return;
    setTransposerPadVisibleWithDebug(false, 'custom-pad-disabled');
  }, [useCustomTransposerPad]);

  function recordTransposerPadDebug(event: string, detail?: string) {
    const summary = `mode=${effectiveTransposerInputMode} custom=${useCustomTransposerPad} visible=${transposerPadVisible} dismissing=${transposerPadDismissInProgressRef.current}`;
    const message = detail ? `${event} | ${detail} | ${summary}` : `${event} | ${summary}`;
    const prefixedMessage = `TRANSPOSE_PAD_DEBUG ${message}`;

    if (shouldConsoleLogTransposerPadDebug) {
      console.log(prefixedMessage);
    }

    setTransposerPadDebugEvents((prev) => [...prev.slice(-5), message]);
  }

  function setTransposerPadVisibleWithDebug(nextVisible: boolean, reason: string) {
    recordTransposerPadDebug(nextVisible ? 'pad-visible:true' : 'pad-visible:false', reason);
    setTransposerPadVisible(nextVisible);
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

  function handleTransposerInputChange(value: string) {
    setTransposerPasteStatus(null);
    setTransposerInput(normalizeTransposerEditInput(value));
  }

  function handleCleanTransposerInput() {
    const cleaned = cleanupTransposerInput(transposerInput, transposerCleanupOptions);
    setTransposerInput(cleaned);
    setTransposerPasteStatus(null);
    setTransposerSelection((prev) => ({
      start: Math.min(prev.start, cleaned.length),
      end: Math.min(prev.end, cleaned.length),
    }));
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

  function insertQuickSymbol(symbol: string) {
    const { nextValue, nextSelection } = insertAtSelection(transposerInput, transposerSelection, symbol);
    setTransposerInput(nextValue);
    setTransposerSelection(nextSelection);
    setTransposerPasteStatus(null);
    transposerInputRef.current?.focus();
  }

  function handleTransposerInputFocus() {
    recordTransposerPadDebug('input-focus');
  }

  function describeTransposerBlurTarget(event: any) {
    const relatedTarget = event?.nativeEvent?.relatedTarget ?? event?.relatedTarget ?? null;
    if (relatedTarget == null) {
      return 'relatedTarget=null';
    }
    if (typeof relatedTarget === 'number') {
      return `relatedTarget=${relatedTarget}`;
    }
    if (typeof relatedTarget === 'object') {
      const maybeElement = relatedTarget as {
        tagName?: string;
        id?: string;
        dataset?: Record<string, string | undefined>;
      };
      const tagName = maybeElement.tagName ?? 'object';
      const idPart = maybeElement.id ? `#${maybeElement.id}` : '';
      const testIdPart = maybeElement.dataset?.testid ? `[data-testid=${maybeElement.dataset.testid}]` : '';
      return `relatedTarget=${tagName}${idPart}${testIdPart}`;
    }
    return `relatedTarget=${String(relatedTarget)}`;
  }

  function openTransposerPad(source: string) {
    recordTransposerPadDebug(source);
    if (!useCustomTransposerPad) return;
    if (transposerPadDismissInProgressRef.current) return;
    setTransposerPadVisibleWithDebug(true, source);
    transposerInputRef.current?.focus();
  }

  function handleTransposerInputPress() {
    openTransposerPad('input-press-in');
  }

  function handleTransposerInputBlur(event: any) {
    const blurTarget = describeTransposerBlurTarget(event);
    recordTransposerPadDebug('input-blur', blurTarget);
    if (!useCustomTransposerPad) return;
    if (Platform.OS === 'web' && !transposerPadDismissInProgressRef.current) {
      recordTransposerPadDebug('input-blur-ignored', blurTarget);
      return;
    }
    setTransposerPadVisibleWithDebug(false, 'input-blur');
  }

  function dismissTransposerPad() {
    recordTransposerPadDebug('dismiss-start');
    transposerPadDismissInProgressRef.current = true;
    transposerInputRef.current?.blur();
    setTransposerPadVisibleWithDebug(false, 'dismiss');
    requestAnimationFrame(() => {
      transposerPadDismissInProgressRef.current = false;
      recordTransposerPadDebug('dismiss-finished');
    });
  }

  function handleDoneWithTransposerPad() {
    dismissTransposerPad();
  }

  function handleTransposerKeyboardPreferenceChange(mode: TransposerInputMode) {
    recordTransposerPadDebug('keyboard-preference-change', `next=${mode}`);
    setTransposerKeyboardPreference(mode === 'pad' ? 'custom' : 'native');
    if (mode === 'native') {
      setTransposerPadVisibleWithDebug(false, 'keyboard-preference-native');
      transposerInputRef.current?.focus();
      return;
    }
    setTransposerPadVisibleWithDebug(true, 'keyboard-preference-pad');
    transposerInputRef.current?.focus();
  }

  function handleTabPadHolePress(hole: string) {
    const { nextValue, nextSelection } = insertTokenAtSelection(transposerInput, transposerSelection, {
      sign: transposerPadSign,
      hole,
      suffix: transposerPadSuffix,
    });
    setTransposerInput(nextValue);
    setTransposerSelection(nextSelection);
    setTransposerPadSuffix('');
    setTransposerPasteStatus(null);
    transposerInputRef.current?.focus();
  }

  function handleTabPadBackspace() {
    const { nextValue, nextSelection } = deleteBackwardAtSelection(transposerInput, transposerSelection);
    setTransposerInput(nextValue);
    setTransposerSelection(nextSelection);
    setTransposerPasteStatus(null);
    transposerInputRef.current?.focus();
  }

  async function handleTabPadPaste() {
    recordTransposerPadDebug('paste-start');

    try {
      const clipboardText = await readClipboardText();

      if (clipboardText.length === 0) {
        setTransposerPasteStatus('Clipboard is empty.');
        recordTransposerPadDebug('paste-empty');
        return;
      }

      const { nextValue, nextSelection } = insertAtSelection(
        transposerInput,
        transposerSelection,
        clipboardText,
      );

      setTransposerInput(nextValue);
      setTransposerSelection(nextSelection);
      setTransposerPasteStatus(null);
      recordTransposerPadDebug('paste-success', `length=${clipboardText.length}`);
      transposerInputRef.current?.focus();
    } catch (error) {
      const nextMessage =
        error instanceof Error && error.message
          ? error.message
          : 'Clipboard paste failed. Try again or switch to Native Keyboard in Settings.';
      setTransposerPasteStatus(nextMessage);
      recordTransposerPadDebug('paste-failed', nextMessage);
    }
  }

  const nextTokenPreview = `${transposerPadSign}4${transposerPadSuffix}`;

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
  const activeTransposerToken =
    transposerFollowState.activeTokenIndex === null
      ? null
      : transposerResult.playableTokens[transposerFollowState.activeTokenIndex] ?? null;
  const toneFollowStatusText = formatToneFollowStatus({
    isListening,
    currentTokenText: activeTransposerToken?.text ?? null,
    status: transposerFollowEvaluation.status,
    centsOffset: transposerFollowEvaluation.centsOffset,
  });
  const statusText = isListening
    ? listenError
      ? listenError
      : activeTab && effectiveConfidence >= AUDIO_CONFIDENCE_GATE
        ? `${activeTab.tab} • ${frequency?.toFixed(1)} Hz ${pitchMatch ? formatCents(pitchMatch.centsOffset) : ''}`
        : 'No signal'
    : 'Off';

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
    setListenError(null);
    setDetectedFrequency(null);
    setDetectedConfidence(0);
    const detector = detectorRef.current;
    if (detector?.isSupported()) {
      try {
        await detector.start((update) => {
          setDetectedFrequency(update.frequency);
          setDetectedConfidence(update.confidence);
          setDetectedRms(update.rms);
          if (update.frequency && update.confidence >= AUDIO_CONFIDENCE_GATE) {
            setLastDetectedAt(Date.now());
          }
        });
        setListenSource('web');
      } catch (error) {
        setListenError('Mic blocked or unavailable (using sim)');
        setListenSource('sim');
      }
    } else {
      setListenError('Mic not supported in this browser (using sim)');
      setListenSource('sim');
    }
    setIsListening(true);
  }

  /**
   * Stops listening and clears detector-related state.
   */
  function stopListening() {
    detectorRef.current?.stop();
    setIsListening(false);
    setListenSource(null);
    setDetectedFrequency(null);
    setDetectedConfidence(0);
    setDetectedRms(0);
    setLastDetectedAt(null);
  }

  const headerTitle =
    screen === 'main' ? 'Harmonica Scale Visualizer' : screen === 'properties' ? 'Properties' : 'Tab Symbols';

  function handleHeaderButtonPress() {
    setScreen((prev) => {
      if (prev === 'main') return 'properties';
      if (prev === 'tab-symbols') return 'properties';
      return 'main';
    });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Text style={styles.title}>{headerTitle}</Text>
          <Pressable onPress={handleHeaderButtonPress} style={styles.gearButton}>
            <Text style={styles.gearButtonText}>{screen === 'main' ? '⚙' : '←'}</Text>
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
                  label="Key Set"
                  value={positionKeyFilter}
                  options={[
                    { label: '1, 2, 3', value: '1-2-3' },
                    { label: '1, 2, 3, 5', value: '1-2-3-5' },
                    { label: 'all', value: 'all' },
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
            <Text style={styles.propertiesTitle}>Transposer Input</Text>
            <View style={styles.propertiesField}>
              <Text style={styles.dropdownLabel}>Keyboard</Text>
              <View style={styles.propertiesChoiceRow}>
                <Pressable
                  onPress={() => handleTransposerKeyboardPreferenceChange('pad')}
                  style={[
                    styles.propertiesChoiceButton,
                    useCustomTransposerPad && styles.propertiesChoiceButtonActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.propertiesChoiceText,
                      useCustomTransposerPad && styles.propertiesChoiceTextActive,
                    ]}
                  >
                    {useCustomTransposerPad ? '◉' : '○'} Custom Tab Pad
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => handleTransposerKeyboardPreferenceChange('native')}
                  style={[
                    styles.propertiesChoiceButton,
                    !useCustomTransposerPad && styles.propertiesChoiceButtonActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.propertiesChoiceText,
                      !useCustomTransposerPad && styles.propertiesChoiceTextActive,
                    ]}
                  >
                    {!useCustomTransposerPad ? '◉' : '○'} Native Keyboard
                  </Text>
                </Pressable>
              </View>
            </View>
            <Pressable
              onPress={() => setStripInvalidTransposerContent((prev) => !prev)}
              style={[
                styles.propertiesToggleButton,
                stripInvalidTransposerContent && styles.propertiesToggleButtonActive,
              ]}
            >
              <Text style={styles.propertiesToggleText}>
                {stripInvalidTransposerContent ? '☑' : '☐'} Strip invalid content from transposer input
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setRemoveExcessTransposerWhitespace((prev) => !prev)}
              style={[
                styles.propertiesToggleButton,
                removeExcessTransposerWhitespace && styles.propertiesToggleButtonActive,
              ]}
            >
              <Text style={styles.propertiesToggleText}>
                {removeExcessTransposerWhitespace ? '☑' : '☐'} Remove excess white space in transposer input
              </Text>
            </Pressable>
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
                  onChange={setScaleRoot}
                />
              </View>
            </View>

            <View style={styles.pagerShell}>
              <ScrollView
                ref={pagerRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                scrollEventThrottle={16}
                onScroll={(event) => {
                  const nextPage = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
                  const boundedPage = nextPage <= 0 ? 0 : 1;
                  setPagerIndex((prev) => (prev === boundedPage ? prev : boundedPage));
                }}
                onMomentumScrollEnd={(event) => {
                  const nextPage = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
                  setPagerIndex(nextPage === 0 ? 0 : 1);
                }}
              >
                <View style={[styles.pagerPage, { width: pageWidth }]}>
                  <View style={styles.pageOneHeader}>
                    <View style={styles.scalePickerColumn}>
                      <Dropdown
                        label="Scale Name"
                        value={scaleId}
                        options={scaleNameDropdownOptions}
                        onChange={setScaleId}
                      />
                    </View>
                    <View style={styles.topRowToggle}>
                      <SingleSelectGroup
                        label="Arpeggios"
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

                  <View style={styles.listenCard}>
                    <View style={styles.listenRow}>
                      <Pressable
                        onPress={() => {
                          if (isListening) {
                            stopListening();
                          } else {
                            startListening();
                          }
                        }}
                        style={[styles.listenButton, isListening && styles.listenButtonActive]}
                      >
                        <Text style={[styles.listenButtonText, isListening && styles.listenButtonTextActive]}>
                          {isListening ? 'Stop' : 'Listen'}
                        </Text>
                      </Pressable>
                      <Text style={styles.listenValue}>{statusText}</Text>
                    </View>
                    {showDebug && (
                      <View style={styles.debugPanel}>
                        <Text style={styles.debugPanelLabel}>Debug Panel</Text>
                        <Text style={styles.debugText}>
                          RMS: {detectedRms.toFixed(4)} · Conf: {detectedConfidence.toFixed(2)} · Hz:{' '}
                          {detectedFrequency ? detectedFrequency.toFixed(1) : '—'}
                        </Text>
                        <Text style={styles.debugText}>
                          Last detect: {lastDetectedAt ? `${now - lastDetectedAt}ms ago` : '—'} · Hold: {holdMs}ms
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
                    )}
                  </View>

                  <View style={styles.resultsList}>
                    <View key={`result:${scale.rootPc}:${scale.scaleId}`} style={styles.resultRow}>
                      <Pressable onPress={() => setMainSelected((prev) => !prev)} style={styles.resultHeader}>
                        <View style={styles.checkboxRow}>
                          <Text style={styles.checkbox}>{mainSelected ? '☑' : '☐'}</Text>
                          <Text style={styles.resultTitle}>
                            {formatScaleLabel(scale.rootPc, scale.scaleId, harmonicaKey.preferFlats)}
                          </Text>
                        </View>
                      </Pressable>
                      {!mainSelected ? null : groups.length === 0 ? (
                        <Text style={styles.resultTabs}>No tabs available.</Text>
                      ) : (
                        <View style={styles.tabGroupList}>
                          {caretPos !== null && (
                            <View
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
                                style={[styles.tabGroup, isSmallScreen && styles.tabGroupCompact]}
                              >
                                <Text
                                  style={[
                                    styles.resultTabs,
                                    isSmallScreen && styles.resultTabsSmall,
                                    option.isRoot && styles.resultTabsRoot,
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
                        <View style={styles.arpeggioSection}>
                          {arpeggioSections.map((section) => (
                            <View key={`arp:${section.id}`} style={styles.arpeggioBlock}>
                              <Text style={styles.arpeggioTitle}>{section.title}</Text>
                              {section.note && <Text style={styles.arpeggioNote}>{section.note}</Text>}
                              {section.items.length === 0 ? (
                                <Text style={styles.arpeggioEmpty}>{section.emptyNote ?? 'None'}</Text>
                              ) : (
                                section.items.map((item) => {
                                  const tabGroups = buildTabsForPcSet(
                                    item.pcs,
                                    item.rootPc,
                                    harmonicaKey.pc,
                                    notation,
                                  );
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
                                        <Text style={styles.checkbox}>
                                          {arpeggioItemSelected[item.id] ? '☑' : '☐'}
                                        </Text>
                                        <Text style={styles.arpeggioLabel}>
                                          {item.label} · {formatNotes(item.orderedPcs, item.rootPc)}
                                        </Text>
                                      </View>
                                      {rowSelected &&
                                        (tabTokens.length === 0 ? (
                                          <Text style={styles.arpeggioTabs}>No tabs available.</Text>
                                        ) : (
                                          <View style={styles.arpeggioTabList}>
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
                                                  token.isRoot && styles.arpeggioTabChipRoot,
                                                ]}
                                              >
                                                <Text
                                                  style={[
                                                    styles.arpeggioTabValue,
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
                  </View>
                </View>

                <View style={[styles.pagerPage, { width: pageWidth }]}>
                  <View style={styles.transposerCard}>
                    <Text style={styles.transposerTitle}>Tab Transposer</Text>
                    <Text style={styles.transposerMeta}>
                      Assumes pasted tabs are first position on a {harmonicaKey.label} harmonica.
                    </Text>
                    <Text style={styles.transposerMeta}>
                      Target: position {targetPosition} ({pcToNote(scale.rootPc, harmonicaKey.preferFlats)})
                    </Text>
                    <View style={styles.transposerFollowControls}>
                      <Pressable
                        testID="transposer-listen-button"
                        onPress={() => {
                          if (isListening) {
                            stopListening();
                          } else {
                            startListening();
                          }
                        }}
                        style={[styles.listenButton, isListening && styles.listenButtonActive]}
                      >
                        <Text style={[styles.listenButtonText, isListening && styles.listenButtonTextActive]}>
                          {isListening ? 'Stop' : 'Listen'}
                        </Text>
                      </Pressable>
                    </View>
                    <Text style={styles.transposerFollowStatus}>{toneFollowStatusText}</Text>
                    {Platform.OS === 'web' && useCustomTransposerPad ? (
                      <Pressable
                        testID="transposer-input-shell"
                        onPress={() => openTransposerPad('input-shell-press')}
                        style={styles.transposerInputShell}
                      >
                        <TextInput
                          ref={transposerInputRef}
                          style={[styles.transposerInput, styles.transposerInputTouchWeb]}
                          multiline
                          value={transposerInput}
                          onChangeText={handleTransposerInputChange}
                          onFocus={handleTransposerInputFocus}
                          onBlur={handleTransposerInputBlur}
                          onSelectionChange={(event) => {
                            const selection = event.nativeEvent.selection;
                            recordTransposerPadDebug(
                              'selection-change',
                              `start=${selection.start} end=${selection.end}`,
                            );
                            setTransposerSelection(selection);
                          }}
                          selection={transposerSelection}
                          keyboardType="default"
                          inputMode="none"
                          showSoftInputOnFocus={false}
                          autoCorrect={false}
                          autoCapitalize="none"
                          spellCheck={false}
                          placeholder="Paste first-position tabs here, for example: 4 -4 5 -5 6"
                          placeholderTextColor="#64748b"
                          textAlignVertical="top"
                          pointerEvents="none"
                        />
                      </Pressable>
                    ) : (
                      <TextInput
                        ref={transposerInputRef}
                        style={[
                          styles.transposerInput,
                          Platform.OS === 'web' && useCustomTransposerPad && styles.transposerInputTouchWeb,
                        ]}
                        multiline
                        value={transposerInput}
                        onChangeText={handleTransposerInputChange}
                        onFocus={handleTransposerInputFocus}
                        onPressIn={handleTransposerInputPress}
                        onBlur={handleTransposerInputBlur}
                        onSelectionChange={(event) => {
                          const selection = event.nativeEvent.selection;
                          recordTransposerPadDebug(
                            'selection-change',
                            `start=${selection.start} end=${selection.end}`,
                          );
                          setTransposerSelection(selection);
                        }}
                        selection={transposerSelection}
                        keyboardType="default"
                        inputMode={useCustomTransposerPad ? 'none' : 'text'}
                        showSoftInputOnFocus={!useCustomTransposerPad}
                        autoCorrect={false}
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="Paste first-position tabs here, for example: 4 -4 5 -5 6"
                        placeholderTextColor="#64748b"
                        textAlignVertical="top"
                      />
                    )}
                    {useCustomTransposerPad && (
                      <Text style={styles.transposerPadHint}>
                        {Platform.OS === 'web'
                          ? 'Custom tab pad is active. Use Paste in the pad for clipboard text, or switch to Native Keyboard in Settings for the browser edit menu.'
                          : 'Tap the field to use the tab pad. Use Paste in the pad for clipboard text, or switch to Native Keyboard in Settings.'}
                      </Text>
                    )}
                    {transposerPasteStatus && <Text style={styles.transposerPadStatus}>{transposerPasteStatus}</Text>}
                    {showDebug && pagerIndex === 1 && (
                      <View style={styles.debugPanel}>
                        <Text style={styles.debugPanelLabel}>Transposer Pad Debug</Text>
                        {transposerPadDebugEvents.length === 0 ? (
                          <Text style={styles.debugText}>No pad events yet.</Text>
                        ) : (
                          transposerPadDebugEvents.map((entry, index) => (
                            <Text key={`transposer-pad-debug:${index}`} style={styles.debugText}>
                              {entry}
                            </Text>
                          ))
                        )}
                      </View>
                    )}
                    <View
                      style={[
                        styles.transposerDirectionRow,
                        isSmallScreen && styles.transposerDirectionRowCompact,
                      ]}
                    >
                      <Text style={[styles.transposerSectionLabel, isSmallScreen && styles.transposerSectionLabelCompact]}>
                        Direction
                      </Text>
                      <View
                        style={[
                          styles.transposerDirectionOptions,
                          isSmallScreen && styles.transposerDirectionOptionsCompact,
                        ]}
                      >
                        <Pressable
                          onPress={() => setTransposerDirection('down')}
                          style={[
                            styles.transposerDirectionOption,
                            isSmallScreen && styles.transposerDirectionOptionCompact,
                            transposerDirection === 'down' && styles.transposerDirectionOptionActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.transposerDirectionText,
                              isSmallScreen && styles.transposerDirectionTextCompact,
                            ]}
                          >
                            {transposerDirection === 'down' ? '◉' : '○'} Down
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setTransposerDirection('up')}
                          style={[
                            styles.transposerDirectionOption,
                            isSmallScreen && styles.transposerDirectionOptionCompact,
                            transposerDirection === 'up' && styles.transposerDirectionOptionActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.transposerDirectionText,
                              isSmallScreen && styles.transposerDirectionTextCompact,
                            ]}
                          >
                            {transposerDirection === 'up' ? '◉' : '○'} Up
                          </Text>
                        </Pressable>
                      </View>
                      <Pressable
                        onPress={handleCleanTransposerInput}
                        style={[styles.transposerActionButton, isSmallScreen && styles.transposerActionButtonCompact]}
                      >
                        <Text
                          style={[
                            styles.transposerActionButtonText,
                            isSmallScreen && styles.transposerActionButtonTextCompact,
                          ]}
                        >
                          Clean Input
                        </Text>
                      </Pressable>
                    </View>
                    <Text style={styles.transposerSectionLabel}>Transposed Output</Text>
                    <ScrollView
                      ref={transposerOutputScrollRef}
                      testID="transposer-output-scroll"
                      style={[styles.transposerOutputBox, { maxHeight: transposerOutputMaxHeight }]}
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
                        {transposerInput.trim().length === 0
                          ? 'Enter tabs above to generate a transposed tab.'
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
                </View>
              </ScrollView>

              <View style={styles.pagerDotsRow}>
                {pagerTabs.map((tab) => {
                  const selected = pagerIndex === tab.page;
                  return (
                    <Pressable
                      key={`dot:${tab.page}`}
                      onPress={() => {
                        setPagerIndex(tab.page);
                        scrollToPagerPage(tab.page, true);
                      }}
                      style={[styles.pagerDot, selected && styles.pagerDotActive]}
                    >
                      <Text style={[styles.pagerDotText, selected && styles.pagerDotTextActive]}>{tab.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {useCustomTransposerPad && (
              <Modal
                transparent
                visible={transposerPadVisible}
                animationType="slide"
                onRequestClose={dismissTransposerPad}
              >
                <View style={styles.transposerPadOverlay}>
                  <Pressable style={StyleSheet.absoluteFill} onPress={dismissTransposerPad} />
                  <View style={styles.transposerPadSheet}>
                    <View style={styles.transposerPadHandle} />
                    <Text style={styles.transposerPadTitle}>Tab Pad</Text>
                    <Text style={styles.transposerPadPreview}>
                      Next token preview: {nextTokenPreview}
                    </Text>
                    <View style={styles.transposerPadSection}>
                      <Text style={styles.transposerPadSectionLabel}>Airflow</Text>
                      <View style={styles.transposerPadOptionRow}>
                        {TAB_PAD_SIGN_OPTIONS.map((option) => {
                          const selected = transposerPadSign === option.value;
                          return (
                            <Pressable
                              key={`sign:${option.label}`}
                              onPress={() => setTransposerPadSign(option.value)}
                              style={[
                                styles.transposerPadOptionButton,
                                selected && styles.transposerPadOptionButtonActive,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.transposerPadOptionText,
                                  selected && styles.transposerPadOptionTextActive,
                                ]}
                              >
                                {option.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                    <View style={styles.transposerPadSection}>
                      <Text style={styles.transposerPadSectionLabel}>Suffix</Text>
                      <View style={styles.transposerPadOptionRow}>
                        {TAB_PAD_SUFFIX_OPTIONS.map((option) => {
                          const selected = transposerPadSuffix === option.value;
                          return (
                            <Pressable
                              key={`suffix:${option.label}`}
                              onPress={() => setTransposerPadSuffix(option.value)}
                              style={[
                                styles.transposerPadOptionButton,
                                selected && styles.transposerPadOptionButtonActive,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.transposerPadOptionText,
                                  selected && styles.transposerPadOptionTextActive,
                                ]}
                              >
                                {option.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                    <View style={styles.transposerPadSection}>
                      <Text style={styles.transposerPadSectionLabel}>Hole</Text>
                      <View style={styles.transposerPadHoleGrid}>
                        {TAB_PAD_HOLES.map((hole) => (
                          <Pressable
                            key={`hole:${hole}`}
                            onPress={() => handleTabPadHolePress(hole)}
                            style={styles.transposerPadHoleButton}
                          >
                            <Text style={styles.transposerPadHoleText}>{hole}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                    <View style={styles.transposerPadActionRow}>
                      <Pressable
                        onPress={handleTabPadPaste}
                        style={styles.transposerPadActionButton}
                      >
                        <Text style={styles.transposerPadActionText}>Paste</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => insertQuickSymbol(' ')}
                        style={styles.transposerPadActionButton}
                      >
                        <Text style={styles.transposerPadActionText}>Space</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => insertQuickSymbol('\n')}
                        style={styles.transposerPadActionButton}
                      >
                        <Text style={styles.transposerPadActionText}>New line</Text>
                      </Pressable>
                      <Pressable
                        onPress={handleTabPadBackspace}
                        style={styles.transposerPadActionButton}
                      >
                        <Text style={styles.transposerPadActionText}>Backspace</Text>
                      </Pressable>
                      <Pressable
                        onPress={handleDoneWithTransposerPad}
                        style={[styles.transposerPadActionButton, styles.transposerPadDoneButton]}
                      >
                        <Text style={[styles.transposerPadActionText, styles.transposerPadDoneText]}>Done</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              </Modal>
            )}
          </>
        )}
      </ScrollView>
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
  propertiesCard: {
    borderRadius: 12,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#182233',
    padding: 12,
    gap: 10,
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
  dropdownCaret: {
    color: '#94a3b8',
    fontWeight: '700',
    marginLeft: 6,
  },
  dropdownCaretCompact: {
    marginLeft: 4,
    fontSize: 11,
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
  toggleItemSelected: {
    borderColor: '#38bdf8',
    backgroundColor: '#0f172a',
  },
  toggleItemText: {
    color: '#e2e8f0',
    fontWeight: '600',
    fontSize: 12,
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
  pagerShell: {
    gap: 10,
  },
  pagerPage: {
    gap: 10,
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
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0f172a',
  },
  listenButtonActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#0b3b4a',
  },
  listenButtonText: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  listenButtonTextActive: {
    color: '#e0f2fe',
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
  propertiesChoiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  propertiesChoiceButton: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  propertiesChoiceButtonActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#0b3b4a',
  },
  propertiesChoiceText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  propertiesChoiceTextActive: {
    color: '#e0f2fe',
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
  transposerInputShell: {
    borderRadius: 10,
  },
  transposerInputTouchWeb: {
    fontSize: 16,
    lineHeight: 24,
  },
  transposerPadHint: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
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
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  transposerFollowStatus: {
    color: '#cbd5e1',
    fontSize: 12,
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
  transposerDirectionText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
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
    paddingHorizontal: 5,
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
  transposerPadOverlay: {
    flex: 1,
    backgroundColor: 'rgba(5, 8, 14, 0.55)',
    justifyContent: 'flex-end',
  },
  transposerPadSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: '#0b1220',
    borderTopWidth: 1,
    borderColor: '#1f2937',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    gap: 12,
  },
  transposerPadHandle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#334155',
    alignSelf: 'center',
  },
  transposerPadTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
  },
  transposerPadPreview: {
    color: '#94a3b8',
    fontFamily: 'Courier',
    fontSize: 12,
  },
  transposerPadSection: {
    gap: 8,
  },
  transposerPadSectionLabel: {
    color: '#94a3b8',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  transposerPadOptionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  transposerPadOptionButton: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  transposerPadOptionButtonActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#0b3b4a',
  },
  transposerPadOptionText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  transposerPadOptionTextActive: {
    color: '#e0f2fe',
  },
  transposerPadHoleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  transposerPadHoleButton: {
    width: '18%',
    minWidth: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transposerPadHoleText: {
    color: '#f8fafc',
    fontFamily: 'Courier',
    fontSize: 16,
    fontWeight: '700',
  },
  transposerPadActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  transposerPadStatus: {
    marginTop: 8,
    color: '#b45309',
    fontSize: 13,
    fontWeight: '600',
  },
  transposerPadActionButton: {
    flexGrow: 1,
    minWidth: 72,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  transposerPadActionText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
  transposerPadDoneButton: {
    borderColor: '#38bdf8',
    backgroundColor: '#0b3b4a',
  },
  transposerPadDoneText: {
    color: '#e0f2fe',
  },
});
