import { useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { HARMONICA_KEYS } from './src/data/keys';
import { SCALE_DEFINITIONS } from './src/data/scales';
import { noteToPc, pcToNote, NoteName } from './src/data/notes';
import { buildTabsForScale, OverbendNotation, ScaleSelection, TabGroup } from './src/logic/tabs';

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

function Dropdown<T extends string | number>(props: {
  label: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = props.options.find((opt) => opt.value === props.value);

  return (
    <View style={styles.dropdown}>
      <Text style={styles.dropdownLabel}>{props.label}</Text>
      <Pressable
        onPress={() => setOpen((prev) => !prev)}
        style={[styles.dropdownTrigger, open && styles.dropdownTriggerOpen]}
      >
        <Text style={styles.dropdownTriggerText}>{active?.label ?? 'Select'}</Text>
        <Text style={styles.dropdownCaret}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open && (
        <View style={styles.dropdownMenu}>
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
        </View>
      )}
    </View>
  );
}

export default function App() {
  const [harmonicaKey, setHarmonicaKey] = useState(HARMONICA_KEYS[0]);
  const [notation, setNotation] = useState<OverbendNotation>('apostrophe');
  const [selectedScales, setSelectedScales] = useState<ScaleSelection[]>([]);
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

  const selectedIds = new Set(selectedScales.map((item) => `${item.rootPc}:${item.scaleId}`));

  function addScale(selection: ScaleSelection) {
    const key = `${selection.rootPc}:${selection.scaleId}`;
    if (selectedIds.has(key)) return;
    setSelectedScales((prev) => [...prev, selection]);
  }

  function removeScale(selection: ScaleSelection) {
    setSelectedScales((prev) => prev.filter((item) => !(item.rootPc === selection.rootPc && item.scaleId === selection.scaleId)));
  }

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


  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Harmonica Scale Visualizer</Text>

        <Text style={styles.sectionTitle}>Harmonica Key</Text>
        <Dropdown
          label="Harmonica Key"
          value={harmonicaKey.label}
          options={HARMONICA_KEYS.map((key) => ({ label: key.label, value: key.label }))}
          onChange={(label) => {
            const key = HARMONICA_KEYS.find((item) => item.label === label);
            if (key) setHarmonicaKey(key);
          }}
        />

        <Text style={styles.sectionTitle}>Overbend Notation</Text>
        <View style={styles.toggleRow}>
          <Pressable
            onPress={() => setNotation('apostrophe')}
            style={[styles.toggleButton, notation === 'apostrophe' && styles.toggleButtonActive]}
          >
            <Text style={[styles.toggleText, notation === 'apostrophe' && styles.toggleTextActive]}>' (context)</Text>
          </Pressable>
          <Pressable
            onPress={() => setNotation('degree')}
            style={[styles.toggleButton, notation === 'degree' && styles.toggleButtonActive]}
          >
            <Text style={[styles.toggleText, notation === 'degree' && styles.toggleTextActive]}>°</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Add Scale</Text>
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
          <Pressable
            onPress={() => addScale({ rootPc: noteToPc(scaleRoot), scaleId })}
            style={styles.addButton}
          >
            <Text style={styles.addButtonText}>Add</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Selected Tabs</Text>
        <View style={styles.resultsList}>
          {selectedScales.map((scale) => {
            const groups = buildTabsForScale(scale, harmonicaKey.pc, notation);
            const defaultOptions = groups.map((group) => {
              const key = getAltKey(scale, group);
              const selectedIndex = altSelections[key] ?? 0;
              return group.options[selectedIndex] ?? group.options[0];
            });
            const chordEligible = new Set<string>();
            const byHoleAndDir = new Map<string, string>();
            defaultOptions.forEach((option) => {
              if (option.technique !== 'blow' && option.technique !== 'draw') return;
              const dir = option.technique === 'blow' ? 'B' : 'D';
              const key = `${option.hole}:${dir}`;
              byHoleAndDir.set(key, key);
            });
            byHoleAndDir.forEach((_, key) => {
              const [holeText, dir] = key.split(':');
              const hole = Number(holeText);
              const prev = `${hole - 1}:${dir}`;
              const next = `${hole + 1}:${dir}`;
              if (byHoleAndDir.has(prev) || byHoleAndDir.has(next)) {
                chordEligible.add(key);
              }
            });
            return (
              <View key={`result:${scale.rootPc}:${scale.scaleId}`} style={styles.resultRow}>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultTitle}>
                    {formatScaleLabel(scale.rootPc, scale.scaleId, harmonicaKey.preferFlats)}
                  </Text>
                  <Pressable onPress={() => removeScale(scale)} style={styles.removeButton}>
                    <Text style={styles.removeButtonText}>Remove</Text>
                  </Pressable>
                </View>
                {groups.length === 0 ? (
                  <Text style={styles.resultTabs}>No tabs available.</Text>
                ) : (
                  <View style={styles.tabGroupList}>
                    {groups.map((group) => {
                      const key = getAltKey(scale, group);
                      const selectedIndex = altSelections[key] ?? 0;
                      const option = group.options[selectedIndex] ?? group.options[0];
                      const chordKey = `${option.hole}:${option.technique === 'blow' ? 'B' : 'D'}`;
                      const shouldUnderline =
                        (option.technique === 'blow' || option.technique === 'draw') &&
                        chordEligible.has(chordKey);
                      return (
                        <View key={key} style={styles.tabGroup}>
                          <Text
                            style={[
                              styles.resultTabs,
                              option.isRoot && styles.resultTabsRoot,
                              shouldUnderline && styles.resultTabsChord,
                            ]}
                          >
                            {option.tab}
                          </Text>
                          {group.options.length > 1 && (
                            <Pressable onPress={() => cycleAlt(scale, group)} style={styles.altButton}>
                              <Text style={styles.altButtonText}>Alt</Text>
                            </Pressable>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
          {selectedScales.length === 0 && (
            <Text style={styles.helperText}>Select a scale to see its tabs.</Text>
          )}
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
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#f3f4f6',
  },
  sectionTitle: {
    fontSize: 16,
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
    paddingVertical: 10,
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
  dropdownItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  dropdownItemText: {
    color: '#e5e7eb',
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 12,
  },
  toggleButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
  },
  toggleButtonActive: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e',
  },
  toggleText: {
    color: '#e2e8f0',
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#0f172a',
  },
  scalePickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 12,
  },
  scalePickerColumn: {
    flex: 1,
    minWidth: 160,
  },
  addButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#38bdf8',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  addButtonText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  removeButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#ef4444',
  },
  removeButtonText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  resultsList: {
    gap: 12,
  },
  resultRow: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#0b1220',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  resultTitle: {
    color: '#e2e8f0',
    fontWeight: '700',
    flex: 1,
  },
  resultTabs: {
    color: '#f8fafc',
    fontFamily: 'Courier',
    lineHeight: 20,
  },
  resultTabsRoot: {
    fontWeight: '700',
    color: '#facc15',
  },
  resultTabsChord: {
    textDecorationLine: 'underline',
  },
  helperText: {
    color: '#94a3b8',
  },
  tabGroupList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tabGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0f172a',
  },
  altButton: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#334155',
  },
  altButtonText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
});
