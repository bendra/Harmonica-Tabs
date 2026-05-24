import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/logic/app-storage', () => ({
  appStorage: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  },
  getAppDatabase: vi.fn(async () => {
    throw new Error('Default database should not be used in this test.');
  }),
}));

import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  parsePreferences,
  PersistedPreferences,
  PREFERENCES_STORAGE_KEY,
  savePreferences,
  serializePreferences,
} from '../../src/logic/preferences';

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    store,
  };
}

describe('parsePreferences', () => {
  it('returns defaults when storage is empty', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it('returns defaults for malformed JSON', () => {
    expect(parsePreferences('not-json-{')).toEqual(DEFAULT_PREFERENCES);
  });

  it('returns defaults when the version is wrong', () => {
    const raw = JSON.stringify({ ...DEFAULT_PREFERENCES, version: 99 });
    expect(parsePreferences(raw)).toEqual(DEFAULT_PREFERENCES);
  });

  it('returns defaults when top-level value is not an object', () => {
    expect(parsePreferences('"a string"')).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('42')).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('[1,2,3]')).toEqual(DEFAULT_PREFERENCES);
  });

  it('round-trips a fully valid preferences blob', () => {
    const sample: PersistedPreferences = {
      version: 1,
      musicalSelection: {
        harmonicaKeyPc: 9, // A
        scaleRoot: 'E',
        scaleId: 'minor_pentatonic',
        arpeggioSelection: 'sevenths',
        harmonicaKeyLabelStyle: 'flat',
        targetKeyLabelStyle: 'sharp',
        notation: 'degree',
        positionKeyFilter: 'all',
        gAltPreference: '3',
      },
      audioSettings: {
        showDebug: true,
        toneToleranceInput: '45',
        toneFollowMinConfidenceInput: '0.5',
        noteSeparationRatioInput: '0.55',
        minSendIntervalMsInput: '100',
        simFrequencyInput: '220',
      },
      ui: {
        screen: 'tabs',
        topRowInverted: true,
      },
      transposer: {
        sourceTabId: 'saved-tab-abc',
        octaveOffset: 2,
      },
    };

    expect(parsePreferences(serializePreferences(sample))).toEqual(sample);
  });

  it('falls back per field when individual values are wrong shapes', () => {
    const raw = JSON.stringify({
      version: 1,
      musicalSelection: {
        harmonicaKeyPc: 'not a number',
        scaleRoot: 'NotANote',
        scaleId: 'unknown-scale',
        arpeggioSelection: 'fourths',
        harmonicaKeyLabelStyle: 'gibberish',
        targetKeyLabelStyle: 'gibberish',
        notation: 'gibberish',
        positionKeyFilter: 'gibberish',
        gAltPreference: 'gibberish',
      },
      audioSettings: {
        showDebug: 'yes',
        toneToleranceInput: 12, // wrong type
      },
      ui: {
        screen: 'properties', // not allowed for persistence
        topRowInverted: 'sometimes',
      },
      transposer: {
        sourceTabId: 0,
        octaveOffset: 'not a number',
      },
    });

    expect(parsePreferences(raw)).toEqual(DEFAULT_PREFERENCES);
  });

  it('rejects out-of-vocabulary harmonica pcs', () => {
    const raw = JSON.stringify({
      ...DEFAULT_PREFERENCES,
      musicalSelection: { ...DEFAULT_PREFERENCES.musicalSelection, harmonicaKeyPc: 42 },
    });
    expect(parsePreferences(raw).musicalSelection.harmonicaKeyPc).toBe(
      DEFAULT_PREFERENCES.musicalSelection.harmonicaKeyPc,
    );
  });

  it('clamps unreasonable octave offsets', () => {
    const raw = JSON.stringify({
      ...DEFAULT_PREFERENCES,
      transposer: { sourceTabId: null, octaveOffset: 1000 },
    });
    expect(parsePreferences(raw).transposer.octaveOffset).toBe(6);

    const negative = JSON.stringify({
      ...DEFAULT_PREFERENCES,
      transposer: { sourceTabId: null, octaveOffset: -1000 },
    });
    expect(parsePreferences(negative).transposer.octaveOffset).toBe(-6);
  });

  it('rejects non-integer octave offsets', () => {
    const raw = JSON.stringify({
      ...DEFAULT_PREFERENCES,
      transposer: { sourceTabId: null, octaveOffset: 1.5 },
    });
    expect(parsePreferences(raw).transposer.octaveOffset).toBe(0);
  });

  it('treats empty-string source tab id as null', () => {
    const raw = JSON.stringify({
      ...DEFAULT_PREFERENCES,
      transposer: { sourceTabId: '', octaveOffset: 0 },
    });
    expect(parsePreferences(raw).transposer.sourceTabId).toBeNull();
  });

  it('fills in missing sections with defaults', () => {
    const raw = JSON.stringify({ version: 1 });
    expect(parsePreferences(raw)).toEqual(DEFAULT_PREFERENCES);
  });

  it('preserves valid fields while replacing invalid neighbors', () => {
    const raw = JSON.stringify({
      version: 1,
      musicalSelection: {
        ...DEFAULT_PREFERENCES.musicalSelection,
        scaleRoot: 'F#',
        notation: 'invalid',
      },
    });
    const parsed = parsePreferences(raw);
    expect(parsed.musicalSelection.scaleRoot).toBe('F#');
    expect(parsed.musicalSelection.notation).toBe(DEFAULT_PREFERENCES.musicalSelection.notation);
  });
});

describe('loadPreferences / savePreferences', () => {
  it('reads from storage under the expected key', async () => {
    const storage = makeStorage();
    const sample: PersistedPreferences = {
      ...DEFAULT_PREFERENCES,
      musicalSelection: { ...DEFAULT_PREFERENCES.musicalSelection, harmonicaKeyPc: 2 },
    };
    storage.store.set(PREFERENCES_STORAGE_KEY, serializePreferences(sample));

    const loaded = await loadPreferences(storage);
    expect(storage.getItem).toHaveBeenCalledWith(PREFERENCES_STORAGE_KEY);
    expect(loaded.musicalSelection.harmonicaKeyPc).toBe(2);
  });

  it('returns defaults when storage is empty', async () => {
    const storage = makeStorage();
    expect(await loadPreferences(storage)).toEqual(DEFAULT_PREFERENCES);
  });

  it('writes a serialized blob under the expected key', async () => {
    const storage = makeStorage();
    await savePreferences(DEFAULT_PREFERENCES, storage);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    const [key, value] = storage.setItem.mock.calls[0]!;
    expect(key).toBe(PREFERENCES_STORAGE_KEY);
    expect(JSON.parse(value as string)).toEqual(DEFAULT_PREFERENCES);
  });

  it('round-trips through storage', async () => {
    const storage = makeStorage();
    const sample: PersistedPreferences = {
      ...DEFAULT_PREFERENCES,
      ui: { screen: 'tabs', topRowInverted: true },
      transposer: { sourceTabId: 'tab-1', octaveOffset: -1 },
    };
    await savePreferences(sample, storage);
    expect(await loadPreferences(storage)).toEqual(sample);
  });
});
