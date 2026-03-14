import { useEffect, useMemo, useRef, useState } from 'react';
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
import { HARMONICA_KEYS } from './src/data/keys';
import { SCALE_DEFINITIONS } from './src/data/scales';
import { noteToPc, pcToNote, NoteName } from './src/data/notes';
import { buildArpeggioSections } from './src/logic/arpeggios';
import { buildTabsForPcSet, buildTabsForScale, OverbendNotation, ScaleSelection, TabGroup } from './src/logic/tabs';
import { matchFrequencyToTabs, TabPitchMatch } from './src/logic/pitch';
import { transposeTabText } from './src/logic/transposer';
import {
  cleanupTransposerInput,
  insertAtSelection,
  TextSelection,
  TransposerCleanupOptions,
} from './src/logic/transposer-input';
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
type QuickSymbol = { label: string; value: string };

/**
 * Reusable single-value dropdown rendered with a modal menu.
 */
function Dropdown<T extends string | number>(props: {
  label: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
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
    <View style={styles.dropdown}>
      <Text style={styles.dropdownLabel}>{props.label}</Text>
      <Pressable
        ref={triggerRef}
        onPress={() => (open ? setOpen(false) : openMenu())}
        style={[styles.dropdownTrigger, open && styles.dropdownTriggerOpen]}
      >
        <Text style={styles.dropdownTriggerText}>{active?.label ?? 'Select'}</Text>
        <Text style={styles.dropdownCaret}>{open ? '▲' : '▼'}</Text>
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
  const [stripInvalidTransposerContent, setStripInvalidTransposerContent] = useState(true);
  const [removeExcessTransposerWhitespace, setRemoveExcessTransposerWhitespace] = useState(true);
  const [listenError, setListenError] = useState<string | null>(null);
  const [listenSource, setListenSource] = useState<'web' | 'sim' | null>(null);
  const [tabLayouts, setTabLayouts] = useState<Array<{ x: number; y: number; width: number; height: number }>>([]);
  const [arpeggioLayouts, setArpeggioLayouts] = useState<
    Record<string, Array<{ x: number; y: number; width: number; height: number }>>
  >({});
  const [mainSelected, setMainSelected] = useState(true);
  const [arpeggioItemSelected, setArpeggioItemSelected] = useState<Record<string, boolean>>({});
  const pagerRef = useRef<ScrollView>(null);
  const transposerInputRef = useRef<TextInput>(null);
  const detectorRef = useRef<ReturnType<typeof createWebAudioPitchDetector> | null>(null);
  const holdMs = 400;
  const toneToleranceCents = 10;

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
  const quickSymbols: QuickSymbol[] = [
    { label: '-', value: '-' },
    { label: "'", value: "'" },
    { label: '°', value: '°' },
    { label: 'space', value: ' ' },
    { label: '↵', value: '\n' },
  ];
  const transposerCleanupOptions = useMemo<TransposerCleanupOptions>(
    () => ({
      stripInvalidContent: stripInvalidTransposerContent,
      removeExcessWhitespace: removeExcessTransposerWhitespace,
    }),
    [stripInvalidTransposerContent, removeExcessTransposerWhitespace],
  );

  useEffect(() => {
    setTransposerDirection(defaultDirection);
  }, [defaultDirection]);

  useEffect(() => {
    const cleaned = cleanupTransposerInput(transposerInput, transposerCleanupOptions);
    if (cleaned === transposerInput) return;

    setTransposerInput(cleaned);
    setTransposerSelection((prev) => ({
      start: Math.min(prev.start, cleaned.length),
      end: Math.min(prev.end, cleaned.length),
    }));
  }, [transposerCleanupOptions, transposerInput]);

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
    setTransposerInput(cleanupTransposerInput(value, transposerCleanupOptions));
  }

  function insertQuickSymbol(symbol: string) {
    const { nextValue, nextSelection } = insertAtSelection(
      transposerInput,
      transposerSelection,
      symbol,
      transposerCleanupOptions,
    );
    setTransposerInput(nextValue);
    setTransposerSelection(nextSelection);
    transposerInputRef.current?.focus();
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
  const hasHold = lastDetectedAt !== null && now - lastDetectedAt < holdMs;
  const effectiveWebFrequency =
    detectedConfidence >= 0.2 && detectedFrequency
      ? detectedFrequency
      : hasHold
        ? detectedFrequency
        : null;
  const frequency = isListening ? (listenSource === 'web' ? effectiveWebFrequency : simHz) : null;
  const midis = groups.map((group) => group.midi);
  const pitchMatch = isListening && frequency ? matchFrequencyToTabs(midis, frequency, 25) : null;
  const caretPos = mainSelected ? getCaretPosition(pitchMatch, tabLayouts) : null;
  const mainInTune =
    pitchMatch !== null && Math.abs(pitchMatch.centsOffset) <= toneToleranceCents;
  const activeTab = pitchMatch ? selectedTabs[pitchMatch.activeIndex] : null;
  const effectiveConfidence = listenSource === 'web' ? detectedConfidence : frequency ? 1 : 0;
  const statusText = isListening
    ? listenError
      ? listenError
      : activeTab && effectiveConfidence >= 0.2
        ? `${activeTab.tab} • ${frequency?.toFixed(1)} Hz ${pitchMatch ? formatCents(pitchMatch.centsOffset) : ''}`
        : 'No signal'
    : 'Off';

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
          if (update.frequency && update.confidence >= 0.2) {
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
            <View style={styles.propertiesField}>
              <Dropdown
                label="Overbend Symbol"
                value={notation}
                options={[
                  { label: "'", value: 'apostrophe' },
                  { label: '°', value: 'degree' },
                ]}
                onChange={(value) => setNotation(value as OverbendNotation)}
              />
            </View>
            <View style={styles.propertiesField}>
              <Dropdown
                label="Position/Key Set"
                value={positionKeyFilter}
                options={[
                  { label: '1, 2, 3', value: '1-2-3' },
                  { label: '1, 2, 3, 5', value: '1-2-3-5' },
                  { label: 'all', value: 'all' },
                ]}
                onChange={(value) => setPositionKeyFilter(value as PositionKeyFilter)}
              />
            </View>
            <View style={styles.propertiesField}>
              <Dropdown
                label="2 Draw / 3 Blow Preference"
                value={gAltPreference}
                options={[
                  { label: '-2', value: '-2' },
                  { label: '3', value: '3' },
                ]}
                onChange={(value) => setGAltPreference(value as '-2' | '3')}
              />
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
                    <TextInput
                      ref={transposerInputRef}
                      style={styles.transposerInput}
                      multiline
                      value={transposerInput}
                      onChangeText={handleTransposerInputChange}
                      onSelectionChange={(event) => setTransposerSelection(event.nativeEvent.selection)}
                      selection={transposerSelection}
                      keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                      autoCorrect={false}
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="Paste first-position tabs here, for example: 4 -4 5 -5 6"
                      placeholderTextColor="#64748b"
                      textAlignVertical="top"
                    />
                    <View style={styles.transposerQuickRow}>
                      {quickSymbols.map((symbol) => (
                        <Pressable
                          key={`symbol:${symbol.label}`}
                          onPress={() => insertQuickSymbol(symbol.value)}
                          style={styles.transposerQuickButton}
                        >
                          <Text style={styles.transposerQuickButtonText}>{symbol.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={styles.transposerDirectionRow}>
                      <Text style={styles.transposerSectionLabel}>Direction</Text>
                      <View style={styles.transposerDirectionOptions}>
                        <Pressable
                          onPress={() => setTransposerDirection('down')}
                          style={[
                            styles.transposerDirectionOption,
                            transposerDirection === 'down' && styles.transposerDirectionOptionActive,
                          ]}
                        >
                          <Text style={styles.transposerDirectionText}>
                            {transposerDirection === 'down' ? '◉' : '○'} Down
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setTransposerDirection('up')}
                          style={[
                            styles.transposerDirectionOption,
                            transposerDirection === 'up' && styles.transposerDirectionOptionActive,
                          ]}
                        >
                          <Text style={styles.transposerDirectionText}>
                            {transposerDirection === 'up' ? '◉' : '○'} Up
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                    <Text style={styles.transposerSectionLabel}>Transposed Output</Text>
                    <View style={styles.transposerOutputBox}>
                      <Text style={styles.transposerOutputText}>
                        {transposerInput.trim().length === 0
                          ? 'Enter tabs above to generate a transposed tab.'
                          : transposerResult.outputSegments.map((segment, index) => (
                              <Text
                                key={`out:${index}`}
                                style={segment.kind === 'error' ? styles.transposerOutputError : undefined}
                              >
                                {segment.text}
                              </Text>
                            ))}
                      </Text>
                    </View>
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
                        pagerRef.current?.scrollTo({ x: tab.page * pageWidth, animated: true });
                      }}
                      style={[styles.pagerDot, selected && styles.pagerDotActive]}
                    >
                      <Text style={[styles.pagerDotText, selected && styles.pagerDotTextActive]}>{tab.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
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
  dropdownLabel: {
    color: '#94a3b8',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
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
  dropdownTriggerOpen: {
    borderColor: '#38bdf8',
  },
  dropdownTriggerText: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  dropdownCaret: {
    color: '#94a3b8',
    fontWeight: '700',
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
  transposerSectionLabel: {
    color: '#94a3b8',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  transposerQuickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  transposerQuickButton: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  transposerQuickButtonText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'lowercase',
  },
  transposerDirectionRow: {
    gap: 6,
  },
  transposerDirectionOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  transposerDirectionOption: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  transposerDirectionOptionActive: {
    borderColor: '#38bdf8',
  },
  transposerDirectionText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  transposerOutputBox: {
    borderWidth: 1,
    borderColor: '#182233',
    borderRadius: 10,
    backgroundColor: '#0a101b',
    paddingVertical: 10,
    paddingHorizontal: 10,
    minHeight: 120,
  },
  transposerOutputText: {
    color: '#f8fafc',
    fontFamily: 'Courier',
    fontSize: 13,
    lineHeight: 20,
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
});
