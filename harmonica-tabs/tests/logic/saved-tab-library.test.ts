import { describe, expect, it, vi } from 'vitest';
import {
  buildSavedTabTitleCandidate,
  createSavedTabLibraryService,
  parseSavedTabLibrary,
  SAVED_TAB_LIBRARY_STORAGE_KEY,
} from '../../src/logic/saved-tab-library';

function createMemoryStorage(initialValue: string | null = null) {
  const values = new Map<string, string>();

  if (initialValue !== null) {
    values.set(SAVED_TAB_LIBRARY_STORAGE_KEY, initialValue);
  }

  return {
    values,
    storage: {
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        values.delete(key);
      }),
    },
  };
}

describe('saved-tab-library', () => {
  it('builds a default title from the first non-empty line', () => {
    expect(buildSavedTabTitleCandidate('\n  4 -4 5 -5  \n6')).toBe('4 -4 5 -5');
  });

  it('safely falls back to an empty library for malformed data', () => {
    expect(parseSavedTabLibrary('not json')).toEqual({ version: 1, tabs: [] });
    expect(parseSavedTabLibrary(JSON.stringify({ version: 99, tabs: [] }))).toEqual({ version: 1, tabs: [] });
  });

  it('saves a new tab record', async () => {
    const memory = createMemoryStorage();
    const service = createSavedTabLibraryService(memory.storage);

    const result = await service.saveTab({
      title: 'Warmup riff',
      inputText: '4 -4 5 -5',
    });

    expect(result.savedTab.title).toBe('Warmup riff');
    expect(result.savedTab.inputText).toBe('4 -4 5 -5');
    expect(result.savedTab.id).toBeTruthy();
    expect(result.savedTab.createdAt).toBe(result.savedTab.updatedAt);

    const storedValue = memory.values.get(SAVED_TAB_LIBRARY_STORAGE_KEY);
    expect(storedValue).toBeTruthy();
    expect(parseSavedTabLibrary(storedValue ?? null).tabs).toHaveLength(1);
  });

  it('updates an existing record without changing its id or createdAt', async () => {
    const memory = createMemoryStorage();
    const service = createSavedTabLibraryService(memory.storage);
    const firstSave = await service.saveTab({
      title: 'Warmup riff',
      inputText: '4 -4 5 -5',
    });

    const secondSave = await service.saveTab({
      id: firstSave.savedTab.id,
      title: 'Warmup riff v2',
      inputText: '4 -4 5 -5 6',
    });

    expect(secondSave.savedTab.id).toBe(firstSave.savedTab.id);
    expect(secondSave.savedTab.createdAt).toBe(firstSave.savedTab.createdAt);
    expect(secondSave.savedTab.updatedAt >= firstSave.savedTab.updatedAt).toBe(true);
    expect(secondSave.tabs).toHaveLength(1);
    expect(secondSave.tabs[0]?.title).toBe('Warmup riff v2');
  });

  it('lists records sorted by most recently updated first', async () => {
    const memory = createMemoryStorage();
    const service = createSavedTabLibraryService(memory.storage);

    const older = await service.saveTab({
      title: 'Older',
      inputText: '4',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    await service.saveTab({
      title: 'Newer',
      inputText: '5',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    await service.saveTab({
      id: older.savedTab.id,
      title: 'Older updated',
      inputText: '4 -4',
    });

    const tabs = await service.listTabs();
    expect(tabs.map((tab) => tab.title)).toEqual(['Older updated', 'Newer']);
  });
});
