import { Platform } from 'react-native';

export type AppStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

type SQLiteDatabase = {
  execAsync: (sql: string) => Promise<void>;
  getFirstAsync: <T>(sql: string, params: unknown[]) => Promise<T | null>;
  runAsync: (sql: string, params: unknown[]) => Promise<void>;
};

let db: SQLiteDatabase | null = null;

async function getDb(): Promise<SQLiteDatabase> {
  if (!db) {
    const SQLite = await import('expo-sqlite');
    db = await SQLite.openDatabaseAsync('harmonica-tabs.db');
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `);
  }
  return db;
}

/**
 * Keeps third-party storage access behind one app-owned interface.
 */
export const appStorage: AppStorage = {
  async getItem(key) {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    const database = await getDb();
    const row = await database.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv_store WHERE key = ?',
      [key],
    );
    return row?.value ?? null;
  },
  async setItem(key, value) {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return;
    }
    const database = await getDb();
    await database.runAsync('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)', [
      key,
      value,
    ]);
  },
  async removeItem(key) {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      return;
    }
    const database = await getDb();
    await database.runAsync('DELETE FROM kv_store WHERE key = ?', [key]);
  },
};
