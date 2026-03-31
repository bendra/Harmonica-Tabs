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

export function getAppDatabase(): Promise<AppDatabase> {
  return Promise.reject(new Error('App database is not used on web. Use appStorage instead.'));
}

export const appStorage: AppStorage = {
  async getItem(key) {
    if (typeof window === 'undefined') {
      return null;
    }
    return window.localStorage.getItem(key);
  },
  async setItem(key, value) {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(key, value);
  },
  async removeItem(key) {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.removeItem(key);
  },
};
