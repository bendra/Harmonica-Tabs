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
  buildSavedTabTitleCandidate,
  createSavedTabLibraryService,
  parseSavedTabLibrary,
  SAVED_TAB_LIBRARY_MIGRATION_KEY,
  SAVED_TAB_LIBRARY_STORAGE_KEY,
} from '../../src/logic/saved-tab-library';

function createMockSavedTabDatabase() {
  const rows = new Map<
    string,
    {
      id: string;
      title: string;
      input_text: string;
      harmonica_pc: number | null;
      position_number: number | null;
      created_at: string;
      updated_at: string;
    }
  >();

  function listRows() {
    return [...rows.values()].sort((left, right) => {
      const titleDelta = left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
      if (titleDelta !== 0) return titleDelta;

      const exactTitleDelta = left.title.localeCompare(right.title);
      if (exactTitleDelta !== 0) return exactTitleDelta;

      const updatedDelta = new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
      if (updatedDelta !== 0) return updatedDelta;

      return left.id.localeCompare(right.id);
    });
  }

  return {
    database: {
      async execAsync() {},
      async getFirstAsync<T>(sql: string, ...params: Array<string | number | boolean | null>) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('count(*) as count')) {
          return { count: rows.size } as T;
        }

        if (normalized.includes('where id = ?')) {
          const row = rows.get(String(params[0]));
          return row ? ({ ...row } as T) : null;
        }

        throw new Error(`Unsupported mock getFirstAsync query: ${sql}`);
      },
      async getAllAsync<T>() {
        return listRows().map((row) => ({ ...row } as T));
      },
      async runAsync(sql: string, ...params: Array<string | number | boolean | null>) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('insert or replace into saved_tabs')) {
          const [id, title, inputText, harmonicaPc, positionNumber, createdAt, updatedAt] = params;
          rows.set(String(id), {
            id: String(id),
            title: String(title),
            input_text: String(inputText),
            harmonica_pc: harmonicaPc === null ? null : Number(harmonicaPc),
            position_number: positionNumber === null ? null : Number(positionNumber),
            created_at: String(createdAt),
            updated_at: String(updatedAt),
          });
          return;
        }

        if (normalized.includes('delete from saved_tabs where id = ?')) {
          rows.delete(String(params[0]));
          return;
        }

        throw new Error(`Unsupported mock runAsync query: ${sql}`);
      },
    },
    listRows,
  };
}

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
    const savedTabDb = createMockSavedTabDatabase();
    const service = createSavedTabLibraryService({
      legacyStorage: memory.storage,
      databaseFactory: async () => savedTabDb.database,
      persistenceMode: 'database',
    });

    const result = await service.saveTab({
      title: 'Warmup riff',
      inputText: '4 -4 5 -5',
    });

    expect(result.savedTab.title).toBe('Warmup riff');
    expect(result.savedTab.inputText).toBe('4 -4 5 -5');
    expect(result.savedTab.id).toBeTruthy();
    expect(result.savedTab.createdAt).toBe(result.savedTab.updatedAt);

    expect(savedTabDb.listRows()).toHaveLength(1);
    expect(memory.values.get(SAVED_TAB_LIBRARY_MIGRATION_KEY)).toBe('1');
  });

  it('updates an existing record without changing its id or createdAt', async () => {
    const memory = createMemoryStorage();
    const savedTabDb = createMockSavedTabDatabase();
    const service = createSavedTabLibraryService({
      legacyStorage: memory.storage,
      databaseFactory: async () => savedTabDb.database,
      persistenceMode: 'database',
    });
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

  it('lists database-backed records sorted by title', async () => {
    const memory = createMemoryStorage();
    const savedTabDb = createMockSavedTabDatabase();
    const service = createSavedTabLibraryService({
      legacyStorage: memory.storage,
      databaseFactory: async () => savedTabDb.database,
      persistenceMode: 'database',
    });

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
    expect(tabs.map((tab) => tab.title)).toEqual(['Newer', 'Older updated']);
  });

  it('migrates legacy blob tabs into the typed store once', async () => {
    const memory = createMemoryStorage(
      JSON.stringify({
        version: 1,
        tabs: [
          {
            id: 'legacy-tab',
            title: 'Legacy',
            inputText: '4 -4',
            createdAt: '2026-03-17T00:00:00.000Z',
            updatedAt: '2026-03-17T00:00:00.000Z',
          },
        ],
      }),
    );
    const savedTabDb = createMockSavedTabDatabase();
    const service = createSavedTabLibraryService({
      legacyStorage: memory.storage,
      databaseFactory: async () => savedTabDb.database,
      persistenceMode: 'database',
    });

    const firstList = await service.listTabs();
    const secondList = await service.listTabs();

    expect(firstList).toHaveLength(1);
    expect(secondList).toHaveLength(1);
    expect(savedTabDb.listRows()).toHaveLength(1);
    expect(memory.values.get(SAVED_TAB_LIBRARY_STORAGE_KEY)).toBeUndefined();
    expect(memory.values.get(SAVED_TAB_LIBRARY_MIGRATION_KEY)).toBe('1');
  });

  it('normalizes malformed partial context to no saved context', async () => {
    const library = parseSavedTabLibrary(
      JSON.stringify({
        version: 1,
        tabs: [
          {
            id: 'legacy-tab',
            title: 'Legacy',
            inputText: '4 -4',
            harmonicaPc: 0,
            createdAt: '2026-03-17T00:00:00.000Z',
            updatedAt: '2026-03-17T00:00:00.000Z',
          },
        ],
      }),
    );

    expect(library.tabs[0]?.harmonicaPc).toBeNull();
    expect(library.tabs[0]?.positionNumber).toBeNull();
  });

  it('persists saved harp and position context when requested', async () => {
    const memory = createMemoryStorage();
    const savedTabDb = createMockSavedTabDatabase();
    const service = createSavedTabLibraryService({
      legacyStorage: memory.storage,
      databaseFactory: async () => savedTabDb.database,
      persistenceMode: 'database',
    });

    const result = await service.saveTab({
      title: 'Context tab',
      inputText: '4 -4',
      harmonicaPc: 0,
      positionNumber: 2,
    });

    expect(result.savedTab.harmonicaPc).toBe(0);
    expect(result.savedTab.positionNumber).toBe(2);
    expect(savedTabDb.listRows()[0]?.harmonica_pc).toBe(0);
    expect(savedTabDb.listRows()[0]?.position_number).toBe(2);
  });

  it('persists saved tabs to the storage blob in web mode', async () => {
    const memory = createMemoryStorage();
    const service = createSavedTabLibraryService({
      legacyStorage: memory.storage,
      persistenceMode: 'storage',
    });

    const result = await service.saveTab({
      title: 'Web tab',
      inputText: '4 -4',
      harmonicaPc: 0,
      positionNumber: 2,
    });

    expect(result.tabs).toHaveLength(1);
    expect(memory.values.get(SAVED_TAB_LIBRARY_STORAGE_KEY)).toBeTruthy();

    const savedLibrary = parseSavedTabLibrary(memory.values.get(SAVED_TAB_LIBRARY_STORAGE_KEY) ?? null);
    expect(savedLibrary.tabs).toHaveLength(1);
    expect(savedLibrary.tabs[0]?.title).toBe('Web tab');
    expect(savedLibrary.tabs[0]?.harmonicaPc).toBe(0);
    expect(savedLibrary.tabs[0]?.positionNumber).toBe(2);
  });
});
