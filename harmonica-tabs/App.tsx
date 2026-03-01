import { useEffect, useMemo, useRef, useState } from 'react';
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
import { noteToPc, pcToNote, NoteName } from './src/data/notes';
import { buildArpeggioSections } from './src/logic/arpeggios';
import { buildTabsForPcSet, buildTabsForScale, OverbendNotation, ScaleSelection, TabGroup } from './src/logic/tabs';
import { matchFrequencyToTabs, TabPitchMatch } from './src/logic/pitch';
import { createWebAudioPitchDetector } from './src/logic/web-audio';

function formatScaleLabel(rootPc: number, scaleId: string, preferFlats: boolean): string {
  const scale = SCALE_DEFINITIONS.find((item) => item.id === scaleId);
  const rootName = pcToNote(rootPc, preferFlats);
  return `${rootName} ${scale ? scale.name : 'Scale'}`;
}

function buildScaleKeyOptions(preferFlats: boolean): NoteName[] {
  return [
    'C',
    preferFlats ? 'Db' : 'C#',
    'D',
    preferFlats ? 'Eb' : 'D#',
    'E',
    'F',
    preferFlats ? 'Gb' : 'F#',
    'G',
    preferFlats ? 'Ab' : 'G#',
    'A',
    preferFlats ? 'Bb' : 'A#',
    'B',
  ];
}

type DropdownOption<T> = {
  label: string;
  value: T;
};

type SingleSelectOption<T extends string> = {
  label: string;
  value: T;
};

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

export default function App() {
  const { width, height } = useWindowDimensions();
  const isSmallScreen = Math.min(width, height) < 420;
  const [harmonicaKey, setHarmonicaKey] = useState(HARMONICA_KEYS[0]);
  const [notation, setNotation] = useState<OverbendNotation>('apostrophe');
  const [arpeggioSelection, setArpeggioSelection] = useState<'triads' | 'sevenths' | 'blues' | null>(null);
  const [scaleRoot, setScaleRoot] = useState<NoteName>('C');
  const [scaleId, setScaleId] = useState<string>(SCALE_DEFINITIONS[0].id);
  const [altSelections, setAltSelections] = useState<Record<string, number>>({});
  const [isListening, setIsListening] = useState(false);
  const [simFrequency, setSimFrequency] = useState('440');
  const [detectedFrequency, setDetectedFrequency] = useState<number | null>(null);
  const [detectedConfidence, setDetectedConfidence] = useState(0);
  const [detectedRms, setDetectedRms] = useState(0);
  const [lastDetectedAt, setLastDetectedAt] = useState<number | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [listenError, setListenError] = useState<string | null>(null);
  const [listenSource, setListenSource] = useState<'web' | 'sim' | null>(null);
  const [tabLayouts, setTabLayouts] = useState<Array<{ x: number; y: number; width: number; height: number }>>([]);
  const [arpeggioLayouts, setArpeggioLayouts] = useState<
    Record<string, Array<{ x: number; y: number; width: number; height: number }>>
  >({});
  const [mainSelected, setMainSelected] = useState(true);
  const [arpeggioItemSelected, setArpeggioItemSelected] = useState<Record<string, boolean>>({});
  const detectorRef = useRef<ReturnType<typeof createWebAudioPitchDetector> | null>(null);
  const holdMs = 400;

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
    return groups.map((group) => {
      const key = getAltKey(scale, group);
      const selectedIndex = altSelections[key] ?? 0;
      return group.options[selectedIndex] ?? group.options[0];
    });
  }, [groups, altSelections, scale]);

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
    () => buildScaleKeyOptions(harmonicaKey.preferFlats),
    [harmonicaKey.preferFlats],
  );

  const scaleKeyDropdownOptions = useMemo<DropdownOption<NoteName>[]>(
    () => scaleKeyOptions.map((note) => ({ label: note, value: note })),
    [scaleKeyOptions],
  );

  const scaleNameDropdownOptions = useMemo<DropdownOption<string>[]>(
    () => SCALE_DEFINITIONS.map((scale) => ({ label: scale.name, value: scale.id })),
    [],
  );

  function getAltKey(scale: ScaleSelection, group: TabGroup): string {
    return `${scale.rootPc}:${scale.scaleId}:${group.midi}`;
  }

  function cycleAlt(scale: ScaleSelection, group: TabGroup) {
    const key = getAltKey(scale, group);
    setAltSelections((prev) => {
      const current = prev[key] ?? 0;
      const next = (current + 1) % group.options.length;
      return { ...prev, [key]: next };
    });
  }

  function formatNotes(pcs: number[], rootPc: number) {
    return pcs.map((pc, index) => (
      <Text key={`${pc}:${index}`} style={pc === rootPc ? styles.arpeggioNotesRoot : undefined}>
        {index === 0 ? pcToNote(pc, harmonicaKey.preferFlats) : `–${pcToNote(pc, harmonicaKey.preferFlats)}`}
      </Text>
    ));
  }

  const caretSize = 18;

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
  const activeTab = pitchMatch ? selectedTabs[pitchMatch.activeIndex] : null;
  const effectiveConfidence = listenSource === 'web' ? detectedConfidence : frequency ? 1 : 0;
  const statusText = isListening
    ? listenError
      ? listenError
      : activeTab && effectiveConfidence >= 0.2
        ? `${activeTab.tab} • ${frequency?.toFixed(1)} Hz ${pitchMatch ? formatCents(pitchMatch.centsOffset) : ''}`
        : 'No signal'
    : 'Off';

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

  function stopListening() {
    detectorRef.current?.stop();
    setIsListening(false);
    setListenSource(null);
    setDetectedFrequency(null);
    setDetectedConfidence(0);
    setDetectedRms(0);
    setLastDetectedAt(null);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Harmonica Scale Visualizer</Text>

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
          <View style={styles.topRowToggle}>
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
          <View style={styles.topRowToggle}>
            <SingleSelectGroup
              label="Arpeggios"
              value={arpeggioSelection}
              options={[
                { label: 'Triads', value: 'triads' },
                { label: '7th', value: 'sevenths' },
                { label: 'Common Blues Chords', value: 'blues' },
              ]}
              onChange={setArpeggioSelection}
            />
          </View>
        </View>

        <View style={styles.scalePickerRow}>
          <View style={styles.scalePickerColumn}>
            <Dropdown
              label="Scale Key"
              value={scaleRoot}
              options={scaleKeyDropdownOptions}
              onChange={setScaleRoot}
            />
          </View>
          <View style={styles.scalePickerColumn}>
            <Dropdown
              label="Scale Name"
              value={scaleId}
              options={scaleNameDropdownOptions}
              onChange={setScaleId}
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
            <Pressable onPress={() => setShowDebug((prev) => !prev)} style={styles.debugToggle}>
              <Text style={styles.debugToggleText}>{showDebug ? 'Hide debug' : 'Show debug'}</Text>
            </Pressable>
          </View>
          {showDebug && (
            <View style={styles.debugPanel}>
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
            {groups.length === 0 ? (
              <Text style={styles.resultTabs}>No tabs available.</Text>
            ) : (
              <Pressable onPress={() => setMainSelected((prev) => !prev)} style={styles.tabGroupList}>
                {caretPos !== null && (
                  <View
                    style={[
                      styles.tabCaret,
                      { left: caretPos.left, top: caretPos.top, width: caretSize, height: caretSize },
                    ]}
                  />
                )}
                {groups.map((group, index) => {
                  const key = getAltKey(scale, group);
                  const option = selectedTabs[index];
                  const hasGAlt =
                    group.options.some((token) => token.tab === '-2') &&
                    group.options.some((token) => token.tab === '3');
                  return (
                    <Pressable
                      key={key}
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
                        if (group.options.length > 1) {
                          cycleAlt(scale, group);
                        }
                      }}
                      style={[styles.tabGroup, isSmallScreen && styles.tabGroupCompact]}
                    >
                      {hasGAlt && (
                        <View pointerEvents="none" style={styles.tabAltIcon}>
                          <Text style={styles.tabAltIconText}>alt</Text>
                        </View>
                      )}
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
              </Pressable>
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
                            const key = getAltKey(scale, group);
                            const selectedIndex = altSelections[key] ?? 0;
                            const option = group.options[selectedIndex] ?? group.options[0];
                            return option
                              ? { tab: option.tab, isRoot: group.isRoot, midi: group.midi }
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
                        const rowCaretPos = rowSelected
                          ? getCaretPosition(rowMatch, arpeggioLayouts[item.id] ?? [])
                          : null;
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
                                          styles.arpeggioTabText,
                                          token.isRoot && styles.arpeggioTabTextRoot,
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
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 12,
  },
  topRowKey: {
    flex: 1,
    minWidth: 180,
  },
  topRowToggle: {
    minWidth: 140,
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
  tabAltIcon: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.45,
    zIndex: 0,
  },
  tabAltIconText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#cbd5f5',
    textTransform: 'uppercase',
    letterSpacing: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.85)',
    borderColor: 'rgba(226, 232, 240, 0.8)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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
    marginLeft: 'auto',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0b1220',
  },
  debugToggleText: {
    color: '#94a3b8',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '700',
  },
  debugPanel: {
    paddingTop: 4,
    gap: 2,
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
  arpeggioTabText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontFamily: 'Courier',
  },
  arpeggioTabTextRoot: {
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
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    zIndex: 3,
  },
});
