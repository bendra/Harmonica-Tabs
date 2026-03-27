export type AppStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

type AsyncStorageModule = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

let asyncStoragePromise: Promise<AsyncStorageModule> | null = null;

async function getAsyncStorageModule() {
  if (!asyncStoragePromise) {
    asyncStoragePromise = import('@react-native-async-storage/async-storage').then(
      (module) => module.default,
    );
  }

  return asyncStoragePromise;
}

/**
 * Keeps third-party storage access behind one app-owned interface.
 */
export const appStorage: AppStorage = {
  async getItem(key) {
    const asyncStorage = await getAsyncStorageModule();
    return asyncStorage.getItem(key);
  },
  async setItem(key, value) {
    const asyncStorage = await getAsyncStorageModule();
    await asyncStorage.setItem(key, value);
  },
  async removeItem(key) {
    const asyncStorage = await getAsyncStorageModule();
    await asyncStorage.removeItem(key);
  },
};
