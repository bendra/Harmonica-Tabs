import { appStorage, AppStorage } from './app-storage';

export type SavedTabRecord = {
  id: string;
  title: string;
  inputText: string;
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
};

export const SAVED_TAB_LIBRARY_STORAGE_KEY = 'harmonica-tabs:saved-tabs';
const SAVED_TAB_LIBRARY_VERSION = 1;

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
    const updatedDelta = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (updatedDelta !== 0) return updatedDelta;
    return left.title.localeCompare(right.title);
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
      tabs: sortSavedTabs(parsed.tabs.filter(isSavedTabRecord)),
    };
  } catch {
    return { version: SAVED_TAB_LIBRARY_VERSION, tabs: [] };
  }
}

export function upsertSavedTabRecord(tabs: SavedTabRecord[], nextRecord: SavedTabRecord) {
  const withoutPrevious = tabs.filter((tab) => tab.id !== nextRecord.id);
  return sortSavedTabs([...withoutPrevious, nextRecord]);
}

export function removeSavedTabRecord(tabs: SavedTabRecord[], id: string) {
  return sortSavedTabs(tabs.filter((tab) => tab.id !== id));
}

export function createSavedTabLibraryService(storage: AppStorage = appStorage) {
  async function readLibrary() {
    const rawValue = await storage.getItem(SAVED_TAB_LIBRARY_STORAGE_KEY);
    return parseSavedTabLibrary(rawValue);
  }

  async function writeLibrary(library: SavedTabLibrary) {
    await storage.setItem(SAVED_TAB_LIBRARY_STORAGE_KEY, JSON.stringify(library));
  }

  return {
    async listTabs() {
      const library = await readLibrary();
      return library.tabs;
    },

    async saveTab(input: SaveTabInput) {
      const nextTitle = input.title.trim();
      if (nextTitle.length === 0) {
        throw new Error('Title is required.');
      }

      const library = await readLibrary();
      const nowIso = new Date().toISOString();
      const existing = input.id ? library.tabs.find((tab) => tab.id === input.id) ?? null : null;
      const savedTab: SavedTabRecord = existing
        ? {
            ...existing,
            title: nextTitle,
            inputText: input.inputText,
            updatedAt: nowIso,
          }
        : {
            id: createSavedTabId(),
            title: nextTitle,
            inputText: input.inputText,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
      const tabs = upsertSavedTabRecord(library.tabs, savedTab);

      await writeLibrary({ version: SAVED_TAB_LIBRARY_VERSION, tabs });

      return { savedTab, tabs };
    },

    async deleteTab(id: string) {
      const library = await readLibrary();
      const tabs = removeSavedTabRecord(library.tabs, id);
      await writeLibrary({ version: SAVED_TAB_LIBRARY_VERSION, tabs });
      return tabs;
    },
  };
}
