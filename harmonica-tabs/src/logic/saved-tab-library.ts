import { appStorage, AppDatabase, AppStorage, getAppDatabase } from './app-storage';
import { Platform } from 'react-native';

export type SavedTabContext = {
  harmonicaPc: number;
  positionNumber: number;
} | null;

export type SavedTabRecord = {
  id: string;
  title: string;
  inputText: string;
  harmonicaPc: number | null;
  positionNumber: number | null;
  createdAt: string;
  updatedAt: string;
};

export type SavedTabLibrary = {
  version: 1;
  tabs: SavedTabRecord[];
};

export type SaveTabInput = {
  id?: string | null;
  title: string;
  inputText: string;
  harmonicaPc?: number | null;
  positionNumber?: number | null;
};

type SavedTabRow = {
  id: string;
  title: string;
  input_text: string;
  harmonica_pc: number | null;
  position_number: number | null;
  created_at: string;
  updated_at: string;
};

type SavedTabLibraryServiceDeps = {
  legacyStorage?: AppStorage;
  databaseFactory?: () => Promise<AppDatabase>;
  persistenceMode?: 'storage' | 'database';
};

export const SAVED_TAB_LIBRARY_STORAGE_KEY = 'harmonica-tabs:saved-tabs';
export const SAVED_TAB_LIBRARY_MIGRATION_KEY = 'harmonica-tabs:saved-tabs:migrated-v2';
const SAVED_TAB_LIBRARY_VERSION = 1;
const SAVED_TAB_TABLE_NAME = 'saved_tabs';

function debugSavedTabLibrary(step: string, details?: Record<string, unknown>) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[saved-tab-library]', step, details ?? {});
  }
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function normalizeSavedTabContextFields(value: {
  harmonicaPc?: unknown;
  positionNumber?: unknown;
}): {
  harmonicaPc: number | null;
  positionNumber: number | null;
} {
  if (isInteger(value.harmonicaPc) && isInteger(value.positionNumber)) {
    return {
      harmonicaPc: value.harmonicaPc,
      positionNumber: value.positionNumber,
    };
  }

  return {
    harmonicaPc: null,
    positionNumber: null,
  };
}

export function getSavedTabContext(record: Pick<SavedTabRecord, 'harmonicaPc' | 'positionNumber'>): SavedTabContext {
  const normalized = normalizeSavedTabContextFields(record);
  if (normalized.harmonicaPc === null || normalized.positionNumber === null) {
    return null;
  }

  return {
    harmonicaPc: normalized.harmonicaPc,
    positionNumber: normalized.positionNumber,
  };
}

function isSavedTabRecord(value: unknown): value is SavedTabRecord {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.inputText === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

function createSavedTabId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `saved-tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function sortSavedTabs(tabs: SavedTabRecord[]) {
  return [...tabs].sort((left, right) => {
    const titleDelta = left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
    if (titleDelta !== 0) return titleDelta;

    const exactTitleDelta = left.title.localeCompare(right.title);
    if (exactTitleDelta !== 0) return exactTitleDelta;

    const updatedDelta = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (updatedDelta !== 0) return updatedDelta;

    return left.id.localeCompare(right.id);
  });
}

export function buildSavedTabTitleCandidate(inputText: string) {
  const firstNonEmptyLine = inputText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstNonEmptyLine) {
    return 'Untitled tab';
  }

  const collapsedWhitespace = firstNonEmptyLine.replace(/\s+/gu, ' ').trim();
  return collapsedWhitespace.slice(0, 60);
}

export function formatSavedTabPreview(inputText: string) {
  const normalized = inputText.replace(/\s+/gu, ' ').trim();
  if (normalized.length === 0) return 'No tab content';
  return normalized.slice(0, 90);
}

function normalizeSavedTabRecord(record: SavedTabRecord): SavedTabRecord {
  const normalizedContext = normalizeSavedTabContextFields(record);
  return {
    ...record,
    harmonicaPc: normalizedContext.harmonicaPc,
    positionNumber: normalizedContext.positionNumber,
  };
}

export function parseSavedTabLibrary(rawValue: string | null): SavedTabLibrary {
  if (!rawValue) {
    return { version: SAVED_TAB_LIBRARY_VERSION, tabs: [] };
  }

  try {
    const parsed = JSON.parse(rawValue) as { version?: unknown; tabs?: unknown };
    if (parsed.version !== SAVED_TAB_LIBRARY_VERSION || !Array.isArray(parsed.tabs)) {
      return { version: SAVED_TAB_LIBRARY_VERSION, tabs: [] };
    }

    return {
      version: SAVED_TAB_LIBRARY_VERSION,
      tabs: sortSavedTabs(parsed.tabs.filter(isSavedTabRecord).map(normalizeSavedTabRecord)),
    };
  } catch {
    return { version: SAVED_TAB_LIBRARY_VERSION, tabs: [] };
  }
}

export function upsertSavedTabRecord(tabs: SavedTabRecord[], nextRecord: SavedTabRecord) {
  const withoutPrevious = tabs.filter((tab) => tab.id !== nextRecord.id);
  return sortSavedTabs([...withoutPrevious, normalizeSavedTabRecord(nextRecord)]);
}

export function removeSavedTabRecord(tabs: SavedTabRecord[], id: string) {
  return sortSavedTabs(tabs.filter((tab) => tab.id !== id));
}

function mapRowToSavedTabRecord(row: SavedTabRow): SavedTabRecord {
  return normalizeSavedTabRecord({
    id: row.id,
    title: row.title,
    inputText: row.input_text,
    harmonicaPc: row.harmonica_pc,
    positionNumber: row.position_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function ensureSavedTabTable(database: AppDatabase) {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS ${SAVED_TAB_TABLE_NAME} (
      id              TEXT PRIMARY KEY NOT NULL,
      title           TEXT NOT NULL,
      input_text      TEXT NOT NULL,
      harmonica_pc    INTEGER NULL,
      position_number INTEGER NULL,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
  `);
}

export function createSavedTabLibraryService({
  legacyStorage = appStorage,
  databaseFactory = getAppDatabase,
  persistenceMode = Platform.OS === 'web' ? 'storage' : 'database',
}: SavedTabLibraryServiceDeps = {}) {
  let databasePromise: Promise<AppDatabase> | null = null;
  let migrationPromise: Promise<void> | null = null;

  async function listTabsFromStorage() {
    return parseSavedTabLibrary(await legacyStorage.getItem(SAVED_TAB_LIBRARY_STORAGE_KEY)).tabs;
  }

  async function writeTabsToStorage(tabs: SavedTabRecord[]) {
    await legacyStorage.setItem(
      SAVED_TAB_LIBRARY_STORAGE_KEY,
      JSON.stringify({
        version: SAVED_TAB_LIBRARY_VERSION,
        tabs,
      } satisfies SavedTabLibrary),
    );
  }

  async function getDatabase() {
    if (!databasePromise) {
      databasePromise = databaseFactory()
        .then(async (database) => {
          await ensureSavedTabTable(database);
          return database;
        })
        .catch((error) => {
          databasePromise = null;
          throw error;
        });
    }

    return databasePromise;
  }

  async function listTabsFromDatabase() {
    const database = await getDatabase();
    const rows = await database.getAllAsync<SavedTabRow>(
      `
        SELECT
          id,
          title,
          input_text,
          harmonica_pc,
          position_number,
          created_at,
          updated_at
        FROM ${SAVED_TAB_TABLE_NAME}
        ORDER BY title COLLATE NOCASE ASC, title ASC, updated_at DESC, id ASC
      `,
    );

    return rows.map(mapRowToSavedTabRecord);
  }

  async function ensureMigrated() {
    if (!migrationPromise) {
      migrationPromise = (async () => {
        const database = await getDatabase();
        const migrationMarker = await legacyStorage.getItem(SAVED_TAB_LIBRARY_MIGRATION_KEY);
        if (migrationMarker === '1') {
          return;
        }

        const existing = await database.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) as count FROM ${SAVED_TAB_TABLE_NAME}`,
        );

        if ((existing?.count ?? 0) > 0) {
          await legacyStorage.setItem(SAVED_TAB_LIBRARY_MIGRATION_KEY, '1');
          await legacyStorage.removeItem(SAVED_TAB_LIBRARY_STORAGE_KEY);
          return;
        }

        const legacyLibrary = parseSavedTabLibrary(await legacyStorage.getItem(SAVED_TAB_LIBRARY_STORAGE_KEY));

        await database.execAsync('BEGIN');
        try {
          for (const tab of legacyLibrary.tabs) {
            const normalizedContext = normalizeSavedTabContextFields(tab);
            await database.runAsync(
              `
                INSERT OR REPLACE INTO ${SAVED_TAB_TABLE_NAME} (
                  id,
                  title,
                  input_text,
                  harmonica_pc,
                  position_number,
                  created_at,
                  updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `,
              tab.id,
              tab.title,
              tab.inputText,
              normalizedContext.harmonicaPc,
              normalizedContext.positionNumber,
              tab.createdAt,
              tab.updatedAt,
            );
          }
          await database.execAsync('COMMIT');
        } catch (error) {
          await database.execAsync('ROLLBACK');
          throw error;
        }

        await legacyStorage.setItem(SAVED_TAB_LIBRARY_MIGRATION_KEY, '1');
        await legacyStorage.removeItem(SAVED_TAB_LIBRARY_STORAGE_KEY);
      })().catch((error) => {
        migrationPromise = null;
        throw error;
      });
    }

    await migrationPromise;
  }

  return {
    async listTabs() {
      debugSavedTabLibrary('listTabs:start');
      if (persistenceMode === 'storage') {
        const tabs = await listTabsFromStorage();
        debugSavedTabLibrary('listTabs:resolved', { count: tabs.length, persistenceMode });
        return tabs;
      }
      await ensureMigrated();
      const tabs = await listTabsFromDatabase();
      debugSavedTabLibrary('listTabs:resolved', { count: tabs.length, persistenceMode });
      return tabs;
    },

    async saveTab(input: SaveTabInput) {
      debugSavedTabLibrary('saveTab:start', {
        hasId: Boolean(input.id),
        titleLength: input.title.trim().length,
      });
      const nextTitle = input.title.trim();
      if (nextTitle.length === 0) {
        throw new Error('Title is required.');
      }

      if (persistenceMode === 'storage') {
        const nowIso = new Date().toISOString();
        const normalizedContext = normalizeSavedTabContextFields(input);
        const existingTabs = await listTabsFromStorage();
        const existingTab = input.id ? existingTabs.find((tab) => tab.id === input.id) ?? null : null;
        const savedTab: SavedTabRecord = existingTab
          ? {
              ...existingTab,
              title: nextTitle,
              inputText: input.inputText,
              harmonicaPc: normalizedContext.harmonicaPc,
              positionNumber: normalizedContext.positionNumber,
              updatedAt: nowIso,
            }
          : {
              id: createSavedTabId(),
              title: nextTitle,
              inputText: input.inputText,
              harmonicaPc: normalizedContext.harmonicaPc,
              positionNumber: normalizedContext.positionNumber,
              createdAt: nowIso,
              updatedAt: nowIso,
            };

        const tabs = upsertSavedTabRecord(existingTabs, savedTab);
        await writeTabsToStorage(tabs);
        debugSavedTabLibrary('saveTab:storage-resolved', { count: tabs.length });
        return { savedTab, tabs };
      }

      await ensureMigrated();
      debugSavedTabLibrary('saveTab:migration-ready');

      const database = await getDatabase();
      debugSavedTabLibrary('saveTab:database-ready');
      const nowIso = new Date().toISOString();
      const normalizedContext = normalizeSavedTabContextFields(input);
      const existing = input.id
        ? await database.getFirstAsync<SavedTabRow>(
            `
              SELECT
                id,
                title,
                input_text,
                harmonica_pc,
                position_number,
                created_at,
                updated_at
              FROM ${SAVED_TAB_TABLE_NAME}
              WHERE id = ?
            `,
            input.id,
          )
        : null;

      const savedTab: SavedTabRecord = existing
        ? {
            ...mapRowToSavedTabRecord(existing),
            title: nextTitle,
            inputText: input.inputText,
            harmonicaPc: normalizedContext.harmonicaPc,
            positionNumber: normalizedContext.positionNumber,
            updatedAt: nowIso,
          }
        : {
            id: createSavedTabId(),
            title: nextTitle,
            inputText: input.inputText,
            harmonicaPc: normalizedContext.harmonicaPc,
            positionNumber: normalizedContext.positionNumber,
            createdAt: nowIso,
            updatedAt: nowIso,
          };

      await database.runAsync(
        `
          INSERT OR REPLACE INTO ${SAVED_TAB_TABLE_NAME} (
            id,
            title,
            input_text,
            harmonica_pc,
            position_number,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        savedTab.id,
        savedTab.title,
        savedTab.inputText,
        savedTab.harmonicaPc,
        savedTab.positionNumber,
        savedTab.createdAt,
        savedTab.updatedAt,
      );
      debugSavedTabLibrary('saveTab:write-resolved', { id: savedTab.id });

      const tabs = await listTabsFromDatabase();
      debugSavedTabLibrary('saveTab:list-resolved', { count: tabs.length });

      return { savedTab, tabs };
    },

    async deleteTab(id: string) {
      if (persistenceMode === 'storage') {
        const tabs = removeSavedTabRecord(await listTabsFromStorage(), id);
        await writeTabsToStorage(tabs);
        return tabs;
      }
      await ensureMigrated();
      const database = await getDatabase();
      await database.runAsync(`DELETE FROM ${SAVED_TAB_TABLE_NAME} WHERE id = ?`, id);
      return listTabsFromDatabase();
    },
  };
}
