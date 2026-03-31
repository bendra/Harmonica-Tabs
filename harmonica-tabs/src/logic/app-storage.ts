import { openDatabaseAsync } from 'expo-sqlite';

export type AppStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type AppDatabaseBindValue = string | number | boolean | null;

export type AppDatabase = {
  execAsync: (sql: string) => Promise<void>;
  getFirstAsync: <T>(sql: string, ...params: AppDatabaseBindValue[]) => Promise<T | null>;
  getAllAsync: <T>(sql: string, ...params: AppDatabaseBindValue[]) => Promise<T[]>;
  runAsync: (sql: string, ...params: AppDatabaseBindValue[]) => Promise<void>;
};

let appDatabasePromise: Promise<AppDatabase> | null = null;

function createAppDatabase() {
  return (async (): Promise<AppDatabase> => {
    const database = await openDatabaseAsync('harmonica-tabs.db');
    await database.execAsync(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key   TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `);

    return {
      execAsync(sql) {
        return database.execAsync(sql);
      },
      getFirstAsync(sql, ...params) {
        return database.getFirstAsync(sql, ...params);
      },
      getAllAsync(sql, ...params) {
        return database.getAllAsync(sql, ...params);
      },
      async runAsync(sql, ...params) {
        await database.runAsync(sql, ...params);
      },
    };
  })();
}

export function getAppDatabase(): Promise<AppDatabase> {
  if (!appDatabasePromise) {
    appDatabasePromise = createAppDatabase().catch((error) => {
      appDatabasePromise = null;
      throw error;
    });
  }

  return appDatabasePromise;
}

/**
 * Keeps third-party storage access behind one app-owned interface.
 */
export const appStorage: AppStorage = {
  async getItem(key) {
    const database = await getAppDatabase();
    const row = await database.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv_store WHERE key = ?',
      key,
    );
    return row?.value ?? null;
  },
  async setItem(key, value) {
    const database = await getAppDatabase();
    await database.runAsync('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)', key, value);
  },
  async removeItem(key) {
    const database = await getAppDatabase();
    await database.runAsync('DELETE FROM kv_store WHERE key = ?', key);
  },
};
