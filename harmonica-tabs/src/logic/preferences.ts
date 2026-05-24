import { appStorage, AppStorage } from './app-storage';
import { DEFAULT_AUDIO_SETTINGS, DEFAULT_MUSICAL_SELECTION } from '../config/default-settings';
import { NoteName, SHARP_NOTES, FLAT_NOTES } from '../data/notes';
import { SCALE_DEFINITIONS } from '../data/scales';
import { HARMONICA_KEYS } from '../data/keys';
import type { OverbendNotation } from './tabs';
import type {
  HarmonicaNoteLabelStyle,
  NoteLabelStyle,
  PositionKeyFilter,
} from '../hooks/use-musical-selection';

export const PREFERENCES_STORAGE_KEY = 'harmonica-tabs:user-preferences:v1';
const PREFERENCES_VERSION = 1;

export type ArpeggioSelection = 'triads' | 'sevenths' | 'blues' | null;
export type PersistedScreen = 'scales' | 'tabs';

export type PersistedPreferences = {
  version: 1;
  musicalSelection: {
    harmonicaKeyPc: number;
    scaleRoot: NoteName;
    scaleId: string;
    arpeggioSelection: ArpeggioSelection;
    harmonicaKeyLabelStyle: HarmonicaNoteLabelStyle;
    targetKeyLabelStyle: NoteLabelStyle;
    notation: OverbendNotation;
    positionKeyFilter: PositionKeyFilter;
    gAltPreference: '-2' | '3';
  };
  audioSettings: {
    showDebug: boolean;
    toneToleranceInput: string;
    toneFollowMinConfidenceInput: string;
    noteSeparationRatioInput: string;
    minSendIntervalMsInput: string;
    simFrequencyInput: string;
  };
  ui: {
    screen: PersistedScreen;
    topRowInverted: boolean;
  };
  transposer: {
    sourceTabId: string | null;
    octaveOffset: number;
  };
};

export const DEFAULT_PREFERENCES: PersistedPreferences = {
  version: PREFERENCES_VERSION,
  musicalSelection: {
    harmonicaKeyPc: DEFAULT_MUSICAL_SELECTION.harmonicaKeyPc,
    scaleRoot: 'C',
    scaleId: SCALE_DEFINITIONS[0].id,
    arpeggioSelection: null,
    harmonicaKeyLabelStyle: DEFAULT_MUSICAL_SELECTION.harmonicaKeyLabelStyle,
    targetKeyLabelStyle: DEFAULT_MUSICAL_SELECTION.targetKeyLabelStyle,
    notation: DEFAULT_MUSICAL_SELECTION.notation,
    positionKeyFilter: DEFAULT_MUSICAL_SELECTION.positionKeyFilter,
    gAltPreference: DEFAULT_MUSICAL_SELECTION.gAltPreference,
  },
  audioSettings: {
    showDebug: DEFAULT_AUDIO_SETTINGS.showDebug,
    toneToleranceInput: DEFAULT_AUDIO_SETTINGS.toneToleranceInput,
    toneFollowMinConfidenceInput: DEFAULT_AUDIO_SETTINGS.toneFollowMinConfidenceInput,
    noteSeparationRatioInput: DEFAULT_AUDIO_SETTINGS.noteSeparationRatioInput,
    minSendIntervalMsInput: DEFAULT_AUDIO_SETTINGS.minSendIntervalMsInput,
    simFrequencyInput: DEFAULT_AUDIO_SETTINGS.simFrequencyInput,
  },
  ui: {
    screen: 'scales',
    topRowInverted: false,
  },
  transposer: {
    sourceTabId: null,
    octaveOffset: 0,
  },
};

const VALID_NOTE_NAMES = new Set<string>([...SHARP_NOTES, ...FLAT_NOTES]);
const VALID_HARMONICA_PCS = new Set<number>(HARMONICA_KEYS.map((key) => key.pc));
const VALID_SCALE_IDS = new Set<string>(SCALE_DEFINITIONS.map((scale) => scale.id));

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function pickHarmonicaPc(value: unknown): number {
  if (typeof value === 'number' && VALID_HARMONICA_PCS.has(value)) {
    return value;
  }
  return DEFAULT_PREFERENCES.musicalSelection.harmonicaKeyPc;
}

function pickNoteName(value: unknown, fallback: NoteName): NoteName {
  return typeof value === 'string' && VALID_NOTE_NAMES.has(value) ? (value as NoteName) : fallback;
}

function pickScaleId(value: unknown): string {
  return typeof value === 'string' && VALID_SCALE_IDS.has(value)
    ? value
    : DEFAULT_PREFERENCES.musicalSelection.scaleId;
}

function pickArpeggio(value: unknown): ArpeggioSelection {
  if (value === null) return null;
  if (value === 'triads' || value === 'sevenths' || value === 'blues') return value;
  return null;
}

function pickSourceTabId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function pickOctaveOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return 0;
  // Guard against unreasonable values from a corrupted store; transposer logic
  // already clamps to what's actually playable per-tab.
  return Math.max(-6, Math.min(6, value));
}

/**
 * Returns sanitized preferences. Any malformed/missing/out-of-range fields
 * fall back to DEFAULT_PREFERENCES so a corrupted blob can never crash startup.
 */
export function parsePreferences(rawValue: string | null): PersistedPreferences {
  if (!rawValue) return DEFAULT_PREFERENCES;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return DEFAULT_PREFERENCES;
  }

  if (!isObject(parsed) || parsed.version !== PREFERENCES_VERSION) {
    return DEFAULT_PREFERENCES;
  }

  const musical = isObject(parsed.musicalSelection) ? parsed.musicalSelection : {};
  const audio = isObject(parsed.audioSettings) ? parsed.audioSettings : {};
  const ui = isObject(parsed.ui) ? parsed.ui : {};
  const transposer = isObject(parsed.transposer) ? parsed.transposer : {};

  return {
    version: PREFERENCES_VERSION,
    musicalSelection: {
      harmonicaKeyPc: pickHarmonicaPc(musical.harmonicaKeyPc),
      scaleRoot: pickNoteName(musical.scaleRoot, DEFAULT_PREFERENCES.musicalSelection.scaleRoot),
      scaleId: pickScaleId(musical.scaleId),
      arpeggioSelection: pickArpeggio(musical.arpeggioSelection),
      harmonicaKeyLabelStyle: pickEnum(
        musical.harmonicaKeyLabelStyle,
        ['standard', 'flat', 'sharp'] as const,
        DEFAULT_PREFERENCES.musicalSelection.harmonicaKeyLabelStyle,
      ),
      targetKeyLabelStyle: pickEnum(
        musical.targetKeyLabelStyle,
        ['flat', 'sharp'] as const,
        DEFAULT_PREFERENCES.musicalSelection.targetKeyLabelStyle,
      ),
      notation: pickEnum(
        musical.notation,
        ['apostrophe', 'degree'] as const,
        DEFAULT_PREFERENCES.musicalSelection.notation,
      ),
      positionKeyFilter: pickEnum(
        musical.positionKeyFilter,
        ['1-2-3', '1-2-3-5', 'all'] as const,
        DEFAULT_PREFERENCES.musicalSelection.positionKeyFilter,
      ),
      gAltPreference: pickEnum(
        musical.gAltPreference,
        ['-2', '3'] as const,
        DEFAULT_PREFERENCES.musicalSelection.gAltPreference,
      ),
    },
    audioSettings: {
      showDebug: pickBoolean(audio.showDebug, DEFAULT_PREFERENCES.audioSettings.showDebug),
      toneToleranceInput: pickString(
        audio.toneToleranceInput,
        DEFAULT_PREFERENCES.audioSettings.toneToleranceInput,
      ),
      toneFollowMinConfidenceInput: pickString(
        audio.toneFollowMinConfidenceInput,
        DEFAULT_PREFERENCES.audioSettings.toneFollowMinConfidenceInput,
      ),
      noteSeparationRatioInput: pickString(
        audio.noteSeparationRatioInput,
        DEFAULT_PREFERENCES.audioSettings.noteSeparationRatioInput,
      ),
      minSendIntervalMsInput: pickString(
        audio.minSendIntervalMsInput,
        DEFAULT_PREFERENCES.audioSettings.minSendIntervalMsInput,
      ),
      simFrequencyInput: pickString(
        audio.simFrequencyInput,
        DEFAULT_PREFERENCES.audioSettings.simFrequencyInput,
      ),
    },
    ui: {
      screen: pickEnum(ui.screen, ['scales', 'tabs'] as const, DEFAULT_PREFERENCES.ui.screen),
      topRowInverted: pickBoolean(ui.topRowInverted, DEFAULT_PREFERENCES.ui.topRowInverted),
    },
    transposer: {
      sourceTabId: pickSourceTabId(transposer.sourceTabId),
      octaveOffset: pickOctaveOffset(transposer.octaveOffset),
    },
  };
}

export function serializePreferences(prefs: PersistedPreferences): string {
  return JSON.stringify(prefs);
}

export async function loadPreferences(storage: AppStorage = appStorage): Promise<PersistedPreferences> {
  const raw = await storage.getItem(PREFERENCES_STORAGE_KEY);
  return parsePreferences(raw);
}

export async function savePreferences(
  prefs: PersistedPreferences,
  storage: AppStorage = appStorage,
): Promise<void> {
  await storage.setItem(PREFERENCES_STORAGE_KEY, serializePreferences(prefs));
}
