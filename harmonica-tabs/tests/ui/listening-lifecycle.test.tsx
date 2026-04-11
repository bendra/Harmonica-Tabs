import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';
import { resetReactNativeMocks } from './react-native.mock';
import { SAVED_TAB_LIBRARY_STORAGE_KEY } from '../../src/logic/saved-tab-library';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const { asyncStorageMock, asyncStorageValues, detectorMockState, savedTabDb } = vi.hoisted(() => {
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
          return [...rows.values()].map((row) => ({ ...row } as T));
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
      reset() {
        rows.clear();
      },
    };
  }

  const values = new Map<string, string>();
  const db = createMockSavedTabDatabase();
  return {
    asyncStorageValues: values,
    asyncStorageMock: {
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
      removeItem: vi.fn(async (key: string) => { values.delete(key); }),
    },
    savedTabDb: db,
    detectorMockState: {
      isSupported: false,
      startQueue: [] as Array<() => Promise<void>>,
      startSpy: vi.fn(),
      stopSpy: vi.fn(),
      updateHandlers: [] as Array<(update: { frequency: number | null; confidence: number; rms: number }) => void>,
    },
  };
});

vi.mock('../../src/logic/app-storage', () => ({
  appStorage: asyncStorageMock,
  getAppDatabase: async () => savedTabDb.database,
}));

vi.mock('../../src/logic/web-audio', () => ({
  createWebAudioPitchDetector: () => ({
    isSupported: () => detectorMockState.isSupported,
    start: (onUpdate: (update: { frequency: number | null; confidence: number; rms: number }) => void) => {
      detectorMockState.updateHandlers.push(onUpdate);
      detectorMockState.startSpy(onUpdate);
      const nextStart = detectorMockState.startQueue.shift();
      return nextStart ? nextStart() : Promise.resolve();
    },
    stop: () => detectorMockState.stopSpy(),
  }),
}));

const { default: App } = await import('../../App');
const { resetSavedTabLibraryServiceForTests } = await import('../../src/hooks/use-saved-tab-library');

function flattenTextChildren(children: any[]): string {
  return children
    .map((child) => {
      if (typeof child === 'string') return child;
      if (!child) return '';
      if (Array.isArray(child)) return flattenTextChildren(child);
      return flattenTextChildren(child.children);
    })
    .join('');
}

function findPressableByText(root: any, text: string) {
  const textNode = root.findAll(
    (node: any) => node.type === 'Text' && flattenTextChildren(node.children).trim() === text,
  )[0];

  if (!textNode) {
    throw new Error(`Could not find Text for: ${text}`);
  }

  let current: any = textNode;
  while (current && current.type !== 'Pressable') {
    current = current.parent;
  }

  if (!current) {
    throw new Error(`Could not find Pressable for text: ${text}`);
  }

  return current;
}

function findByTestId(root: any, testID: string) {
  return root.find((node: any) => node.props?.testID === testID);
}

function flattenStyles(style: any): any[] {
  if (!style) return [];
  if (Array.isArray(style)) {
    return style.flatMap((entry) => flattenStyles(entry));
  }
  return [style];
}

function pressableHasActiveListenStyle(node: any) {
  return flattenStyles(node.props?.style).some(
    (style) => style?.backgroundColor === '#0b3b4a' && style?.borderColor === '#38bdf8',
  );
}

function seedSavedTabs(tabs: Array<Record<string, string>>) {
  asyncStorageValues.set(
    SAVED_TAB_LIBRARY_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      tabs,
    }),
  );
}

function goToTabs(root: any) {
  act(() => {
    findByTestId(root, 'workspace-tabs-button').props.onPress();
  });
}

async function openLibraryTab(root: any, id: string) {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  await act(async () => {
    findByTestId(root, `saved-tab-open:${id}`).props.onPress();
    await Promise.resolve();
  });
}

async function renderApp() {
  let renderer: any;

  await act(async () => {
    renderer = TestRenderer.create(<App />);
    await Promise.resolve();
    await Promise.resolve();
  });

  return renderer;
}

describe('App listening lifecycle', () => {
  beforeEach(() => {
    resetReactNativeMocks();
    asyncStorageValues.clear();
    savedTabDb.reset();
    resetSavedTabLibraryServiceForTests();
    asyncStorageMock.getItem.mockClear();
    asyncStorageMock.setItem.mockClear();
    asyncStorageMock.removeItem.mockClear();
    detectorMockState.isSupported = false;
    detectorMockState.startQueue = [];
    detectorMockState.startSpy.mockClear();
    detectorMockState.stopSpy.mockClear();
    detectorMockState.updateHandlers = [];
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal('navigator', {
      maxTouchPoints: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stops the detector when the app unmounts during a pending startup', async () => {
    detectorMockState.isSupported = true;
    const pendingStart = createDeferred<void>();
    detectorMockState.startQueue.push(() => pendingStart.promise);

    const renderer = await renderApp();
    const root = renderer.root;

    await act(async () => {
      findPressableByText(root, '🎤 Listen').props.onPress();
      await Promise.resolve();
    });

    act(() => {
      renderer.unmount();
    });

    expect(detectorMockState.stopSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingStart.resolve();
      await pendingStart.promise;
      await Promise.resolve();
    });

    expect(detectorMockState.stopSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores stale startup completion when a newer listen request is pending', async () => {
    detectorMockState.isSupported = true;
    const firstStart = createDeferred<void>();
    const secondStart = createDeferred<void>();
    detectorMockState.startQueue.push(() => firstStart.promise, () => secondStart.promise);

    const renderer = await renderApp();
    const root = renderer.root;

    await act(async () => {
      const listenButton = findPressableByText(root, '🎤 Listen');
      listenButton.props.onPress();
      await Promise.resolve();
      listenButton.props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      firstStart.resolve();
      await firstStart.promise;
      await Promise.resolve();
    });

    expect(pressableHasActiveListenStyle(findPressableByText(root, '🎤 Listen'))).toBe(false);

    await act(async () => {
      secondStart.resolve();
      await secondStart.promise;
      await Promise.resolve();
    });

    expect(pressableHasActiveListenStyle(findPressableByText(root, '🎤 Listen'))).toBe(true);
  });

  it('cleans up the transposer follow interval when the source tab is cleared', async () => {
    vi.useFakeTimers();
    seedSavedTabs([
      {
        id: 'source',
        title: 'Source',
        inputText: '4 -4',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
    ]);

    const renderer = await renderApp();
    const root = renderer.root;

    goToTabs(root);
    await openLibraryTab(root, 'source');

    await act(async () => {
      findByTestId(root, 'transposer-listen-button').props.onPress();
      await Promise.resolve();
    });

    expect(vi.getTimerCount()).toBeGreaterThan(0);

    act(() => {
      findByTestId(root, 'transposer-choose-tab-button').props.onPress();
    });

    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      renderer.unmount();
    });
  });
});
