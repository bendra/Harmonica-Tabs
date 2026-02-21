import { useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { HARMONICA_KEYS } from './src/data/keys';
import { SCALE_DEFINITIONS } from './src/data/scales';
import { noteToPc, pcToNote, NoteName } from './src/data/notes';
import { buildArpeggioSections } from './src/logic/arpeggios';
import { buildTabsForPcSet, buildTabsForScale, OverbendNotation, ScaleSelection, TabGroup } from './src/logic/tabs';

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

        <View style={styles.resultsList}>
          {(() => {
            const scale = { rootPc: noteToPc(scaleRoot), scaleId } satisfies ScaleSelection;
            const groups = buildTabsForScale(scale, harmonicaKey.pc, notation);
            const defaultOptions = groups.map((group) => {
              const key = getAltKey(scale, group);
              const selectedIndex = altSelections[key] ?? 0;
              return group.options[selectedIndex] ?? group.options[0];
            });

            const arpeggioSections = buildArpeggioSections(
              scale.rootPc,
              scale.scaleId,
              arpeggioSelection ? [arpeggioSelection] : [],
            );
            return (
              <View key={`result:${scale.rootPc}:${scale.scaleId}`} style={styles.resultRow}>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultTitle}>
                    {formatScaleLabel(scale.rootPc, scale.scaleId, harmonicaKey.preferFlats)}
                  </Text>
                </View>
                {groups.length === 0 ? (
                  <Text style={styles.resultTabs}>No tabs available.</Text>
                ) : (
                  <View style={styles.tabGroupList}>
                    {groups.map((group) => {
                      const key = getAltKey(scale, group);
                      const selectedIndex = altSelections[key] ?? 0;
                      const option = group.options[selectedIndex] ?? group.options[0];
                      const hasGAlt =
                        group.options.some((token) => token.tab === '-2') &&
                        group.options.some((token) => token.tab === '3');
                      return (
                        <Pressable
                          key={key}
                          onPress={() => {
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
                                const key = getAltKey(scale, group);
                                const selectedIndex = altSelections[key] ?? 0;
                                const tab = group.options[selectedIndex]?.tab ?? group.options[0]?.tab;
                                return tab ? { tab, isRoot: group.isRoot } : null;
                              })
                              .filter(Boolean) as Array<{ tab: string; isRoot: boolean }>;
                            return (
                              <View key={item.id} style={styles.arpeggioRow}>
                                <Text style={styles.arpeggioLabel}>
                                  {item.label} · {formatNotes(item.orderedPcs, item.rootPc)}
                                </Text>
                                {tabTokens.length === 0 ? (
                                  <Text style={styles.arpeggioTabs}>No tabs available.</Text>
                                ) : (
                                  <Text style={styles.arpeggioTabs}>
                                    {tabTokens.map((token, index) => (
                                      <Text
                                        key={`${item.id}:tab:${index}`}
                                        style={token.isRoot ? styles.arpeggioTabsRoot : undefined}
                                      >
                                        {index === 0 ? token.tab : ` ${token.tab}`}
                                      </Text>
                                    ))}
                                  </Text>
                                )}
                              </View>
                            );
                          })
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })()}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
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
    fontSize: 26,
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
    padding: 14,
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
    marginBottom: 4,
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
  arpeggioSection: {
    marginTop: 6,
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
    gap: 1,
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
  arpeggioTabsRoot: {
    color: '#facc15',
    fontWeight: '700',
  },
  tabGroupList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tabGroup: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1a2230',
    backgroundColor: '#121826',
  },
  tabGroupCompact: {
    paddingHorizontal: 0,
    gap: 4,
  },
});
