import { useState, useEffect, useMemo } from 'react';
import { HARMONICA_KEYS, HarmonicaKey } from '../data/keys';
import { SCALE_DEFINITIONS } from '../data/scales';
import { noteToPc, normalizePc, pcToNote, NoteName } from '../data/notes';
import { buildTabsForScale, OverbendNotation, ScaleSelection, TabGroup } from '../logic/tabs';
import { buildArpeggioSections } from '../logic/arpeggios';
import { DEFAULT_MUSICAL_SELECTION } from '../config/default-settings';

export function formatScaleLabel(rootPc: number, scaleId: string, preferFlats: boolean): string {
  const scaleDef = SCALE_DEFINITIONS.find((item) => item.id === scaleId);
  const rootName = pcToNote(rootPc, preferFlats);
  return `${rootName} ${scaleDef ? scaleDef.name : 'Scale'}`;
}

export type ScaleKeyOption = {
  position: number;
  note: NoteName;
};

export type DropdownOption<T> = {
  label: string;
  value: T;
};

export type HarmonicaNoteLabelStyle = 'standard' | 'flat' | 'sharp';
export type NoteLabelStyle = 'flat' | 'sharp';

export function getHarmonicaKeyPreferFlats(style: HarmonicaNoteLabelStyle, harmonicaPc: number) {
  if (style === 'flat') return true;
  if (style === 'sharp') return false;
  return HARMONICA_KEYS.find((key) => key.pc === harmonicaPc)?.preferFlats ?? false;
}

export function formatOrdinal(value: number) {
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

export function getTargetRootPcForPosition(harmonicaPc: number, positionNumber: number) {
  return normalizePc(harmonicaPc + (positionNumber - 1) * 7);
}

export function getPositionNumberForTargetRootPc(harmonicaPc: number, targetRootPc: number) {
  return normalizePc((targetRootPc - harmonicaPc) * 7) + 1;
}

export function formatPositionKeyLabel(positionNumber: number, targetRootPc: number, preferFlats: boolean) {
  return `${formatOrdinal(positionNumber)} / ${pcToNote(targetRootPc, preferFlats)}`;
}

export function buildScaleKeyOptions(harmonicaPc: number, preferFlats: boolean): ScaleKeyOption[] {
  return Array.from({ length: 12 }, (_, index) => {
    const position = index + 1;
    const rootPc = getTargetRootPcForPosition(harmonicaPc, position);
    return {
      position,
      note: pcToNote(rootPc, preferFlats),
    };
  });
}

export function getPreferredTabOption(group: TabGroup, gAltPreference: '-2' | '3') {
  const hasMinusTwo = group.options.some((token) => token.tab === '-2');
  const hasThree = group.options.some((token) => token.tab === '3');
  if (hasMinusTwo && hasThree) {
    return group.options.find((token) => token.tab === gAltPreference) ?? group.options[0];
  }
  return group.options[0];
}

export type PositionKeyFilter = '1-2-3' | '1-2-3-5' | 'all';

export function useMusicalSelection() {
  const [harmonicaKey, setHarmonicaKey] = useState<HarmonicaKey>(
    HARMONICA_KEYS.find((key) => key.pc === DEFAULT_MUSICAL_SELECTION.harmonicaKeyPc) ?? HARMONICA_KEYS[0],
  );
  const [harmonicaKeyLabelStyle, setHarmonicaKeyLabelStyle] = useState<HarmonicaNoteLabelStyle>(
    DEFAULT_MUSICAL_SELECTION.harmonicaKeyLabelStyle,
  );
  const [targetKeyLabelStyle, setTargetKeyLabelStyle] = useState<NoteLabelStyle>(
    DEFAULT_MUSICAL_SELECTION.targetKeyLabelStyle,
  );
  const [notation, setNotation] = useState<OverbendNotation>(DEFAULT_MUSICAL_SELECTION.notation);
  const [positionKeyFilter, setPositionKeyFilter] = useState<PositionKeyFilter>(
    DEFAULT_MUSICAL_SELECTION.positionKeyFilter,
  );
  const [gAltPreference, setGAltPreference] = useState<'-2' | '3'>(DEFAULT_MUSICAL_SELECTION.gAltPreference);
  const [arpeggioSelection, setArpeggioSelection] = useState<'triads' | 'sevenths' | 'blues' | null>(null);
  const [scaleRoot, setScaleRoot] = useState<NoteName>('C');
  const [scaleId, setScaleId] = useState<string>(SCALE_DEFINITIONS[0].id);
  const harmonicaKeyPreferFlats = getHarmonicaKeyPreferFlats(harmonicaKeyLabelStyle, harmonicaKey.pc);
  const targetKeyPreferFlats = targetKeyLabelStyle === 'flat';

  const scale = useMemo(
    () => ({ rootPc: noteToPc(scaleRoot), scaleId } satisfies ScaleSelection),
    [scaleRoot, scaleId],
  );

  const groups = useMemo(
    () => buildTabsForScale(scale, harmonicaKey.pc, notation),
    [scale, harmonicaKey.pc, notation],
  );

  const selectedTabs = useMemo(
    () => groups.map((group) => getPreferredTabOption(group, gAltPreference)),
    [groups, gAltPreference],
  );

  const arpeggioSections = useMemo(
    () => buildArpeggioSections(scale.rootPc, scale.scaleId, arpeggioSelection ? [arpeggioSelection] : []),
    [scale, arpeggioSelection],
  );

  const harmonicaKeyDropdownOptions = useMemo<DropdownOption<number>[]>(
    () =>
      HARMONICA_KEYS.map((key) => ({
        label: harmonicaKeyLabelStyle === 'standard' ? key.label : pcToNote(key.pc, harmonicaKeyLabelStyle === 'flat'),
        value: key.pc,
      })),
    [harmonicaKeyLabelStyle],
  );

  const scaleKeyOptions = useMemo(
    () => buildScaleKeyOptions(harmonicaKey.pc, targetKeyPreferFlats),
    [harmonicaKey.pc, targetKeyPreferFlats],
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
    () => SCALE_DEFINITIONS.map((s) => ({ label: s.name, value: s.id })),
    [],
  );

  const firstPositionRoot = useMemo(
    () => pcToNote(harmonicaKey.pc, targetKeyPreferFlats),
    [harmonicaKey.pc, targetKeyPreferFlats],
  );

  // Keep the selected target root visible and respell it when the flat/sharp display style changes.
  useEffect(() => {
    const scaleRootPc = noteToPc(scaleRoot);
    const matchingOption = scaleKeyDropdownOptions.find((option) => noteToPc(option.value) === scaleRootPc);
    if (matchingOption) {
      if (matchingOption.value !== scaleRoot) {
        setScaleRoot(matchingOption.value);
      }
      return;
    }

    const nextOption = scaleKeyDropdownOptions[0];
    if (nextOption && nextOption.value !== scaleRoot) {
      setScaleRoot(nextOption.value);
    }
  }, [scaleKeyDropdownOptions, scaleRoot]);

  return {
    harmonicaKey,
    setHarmonicaKey,
    harmonicaKeyLabelStyle,
    setHarmonicaKeyLabelStyle,
    harmonicaKeyDropdownOptions,
    targetKeyLabelStyle,
    setTargetKeyLabelStyle,
    harmonicaKeyPreferFlats,
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
  };
}
