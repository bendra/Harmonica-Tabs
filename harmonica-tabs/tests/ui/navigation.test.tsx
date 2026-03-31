import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';
import { resetReactNativeMocks, scrollToSpy, setReactNativeWindowDimensions } from './react-native.mock';
import { SAVED_TAB_LIBRARY_STORAGE_KEY } from '../../src/logic/saved-tab-library';
import { HARMONICA_KEYS } from '../../src/data/keys';
import { buildTabsForScale } from '../../src/logic/tabs';

const { asyncStorageMock, asyncStorageValues, savedTabDb } = vi.hoisted(() => {
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
      reset() {
        rows.clear();
      },
      listRows,
    };
  }

  const values = new Map<string, string>();
  const db = createMockSavedTabDatabase();
  const mock = {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { values.delete(key); }),
  };
  return { asyncStorageValues: values, asyncStorageMock: mock, savedTabDb: db };
});

vi.mock('../../src/logic/app-storage', () => ({
  appStorage: asyncStorageMock,
  getAppDatabase: async () => savedTabDb.database,
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

function findDropdownByLabel(root: any, label: string) {
  return root.find((node: any) => typeof node.type === 'function' && node.props?.label === label);
}

function findDropdownByTestId(root: any, testID: string) {
  return root.find((node: any) => typeof node.type === 'function' && node.props?.testID === testID);
}

function findAllText(root: any, text: string) {
  return root.findAll((node: any) => node.type === 'Text' && flattenTextChildren(node.children).trim() === text);
}

function flattenStyle(style: any): any[] {
  if (!style) return [];
  if (Array.isArray(style)) return style.flatMap((item) => flattenStyle(item));
  return [style];
}

function readStyleNumber(style: any, key: string) {
  return flattenStyle(style).reduce<number | undefined>(
    (value, entry) => (typeof entry?.[key] === 'number' ? entry[key] : value),
    undefined,
  );
}

function findTextInput(root: any) {
  return root.find((node: any) => node.type === 'TextInput');
}

function findTransposerOutputScroll(root: any) {
  return root.find((node: any) => node.type === 'ScrollView' && node.props.testID === 'transposer-output-scroll');
}

function findTransposerOutputTextNode(root: any) {
  return findTransposerOutputScroll(root).findAll((node: any) => node.type === 'Text')[0];
}

function findSavedTabsScroll(root: any) {
  return root.find((node: any) => node.type === 'ScrollView' && node.props.testID === 'saved-tabs-scroll');
}

function findScalesResultsScroll(root: any) {
  return root.find((node: any) => node.type === 'ScrollView' && node.props.testID === 'scales-results-scroll');
}

function readTransposerOutputText(root: any) {
  return flattenTextChildren(findTransposerOutputScroll(root).children).trim();
}

function measureTransposerOutput(root: any, height: number) {
  const outputScroll = findTransposerOutputScroll(root);

  act(() => {
    outputScroll.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 320, height } } });
  });

  return outputScroll;
}

function measureTransposerToken(root: any, tokenIndex: number, y: number, height = 20) {
  const token = findByTestId(root, `transposer-output-token:${tokenIndex}`);

  act(() => {
    token.props.onLayout({ nativeEvent: { layout: { x: 0, y, width: 24, height } } });
  });

  return token;
}

function findByTestId(root: any, testID: string) {
  return root.find((node: any) => node.props?.testID === testID);
}

function findNodeOrder(root: any, predicate: (node: any) => boolean) {
  return root.findAll(() => true).findIndex(predicate);
}

function stubWebInputEnvironment(params: { coarsePointerMatches: boolean; maxTouchPoints: number }) {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: query === '(hover: none) and (pointer: coarse)' ? params.coarsePointerMatches : false,
    }),
  });
  vi.stubGlobal('navigator', {
    maxTouchPoints: params.maxTouchPoints,
  });
}

function seedSavedTabs(tabs: Array<Record<string, any>>) {
  asyncStorageValues.set(
    SAVED_TAB_LIBRARY_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      tabs,
    }),
  );
}

function readSavedTabsFromStorage() {
  const rawValue = asyncStorageValues.get(SAVED_TAB_LIBRARY_STORAGE_KEY) ?? null;
  if (!rawValue) return [];
  const parsed = JSON.parse(rawValue) as { tabs?: Array<Record<string, any>> };
  return Array.isArray(parsed.tabs) ? parsed.tabs : [];
}

function goToTabs(root: any) {
  act(() => {
    findByTestId(root, 'workspace-tabs-button').props.onPress();
  });
}

function goToTransposer(root: any) {
  goToTabs(root);
}

function openCreateTab(root: any) {
  act(() => {
    const libraryNewButton = root.findAll((node: any) => node.props?.testID === 'library-new-button')[0] ?? null;
    if (libraryNewButton) {
      libraryNewButton.props.onPress();
      return;
    }
    findPressableByText(root, 'Create Tab').props.onPress();
  });
}

function openLibraryFromTransposer(root: any) {
  act(() => {
    const chooseTabButton = root.findAll(
      (node: any) => node.type === 'Text' && flattenTextChildren(node.children).trim() === 'Choose Tab',
    )[0];
    if (!chooseTabButton) {
      return;
    }
    findPressableByText(root, 'Choose Tab').props.onPress();
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

function chooseTargetPosition(root: any, label: string) {
  act(() => {
    findDropdownByLabel(root, 'Target Position/Key').props.onChange(label.split(' / ')[1]);
  });
}

function chooseHarmonicaKey(root: any, pc: number) {
  act(() => {
    findDropdownByLabel(root, 'Harmonica key').props.onChange(pc);
  });
}

async function editLibraryTab(root: any, id: string) {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  await act(async () => {
    findByTestId(root, `saved-tab-edit:${id}`).props.onPress();
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

function renderAppAtSize(width: number, height: number) {
  setReactNativeWindowDimensions({ width, height });
  return renderApp();
}

describe('App navigation', () => {
  beforeEach(() => {
    resetReactNativeMocks();
    asyncStorageValues.clear();
    savedTabDb.reset();
    resetSavedTabLibraryServiceForTests();
    asyncStorageMock.getItem.mockClear();
    asyncStorageMock.setItem.mockClear();
    asyncStorageMock.removeItem.mockClear();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns to the tabs workspace after leaving properties', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    goToTabs(root);
    expect(findAllText(root, 'Saved Tabs').length).toBeGreaterThan(0);

    act(() => {
      findPressableByText(root, '⚙').props.onPress();
    });

    expect(() => root.find((node: any) => node.type === 'Text' && flattenTextChildren(node.children) === 'Properties')).not.toThrow();

    act(() => {
      findPressableByText(root, '←').props.onPress();
    });

    expect(findAllText(root, 'Saved Tabs').length).toBeGreaterThan(0);
    expect(findAllText(root, 'New Tab').length).toBeGreaterThan(0);
  });

  it('opens Tabs on the library by default until a transposer source exists', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    goToTabs(root);

    expect(findAllText(root, 'Saved Tabs').length).toBeGreaterThan(0);
    expect(findAllText(root, 'New Tab').length).toBeGreaterThan(0);
  });

  it('scales the Scales workspace up across compact, regular, and wide widths', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const compactRenderer = await renderAppAtSize(390, 844);
    const compactRoot = compactRenderer.root;
    const compactTabText = findByTestId(compactRoot, 'main-tab-group:1').findByType('Text');
    const compactShell = findByTestId(compactRoot, 'scales-workspace-shell');

    const regularRenderer = await renderAppAtSize(700, 1024);
    const regularRoot = regularRenderer.root;
    const regularTabText = findByTestId(regularRoot, 'main-tab-group:1').findByType('Text');
    const regularShell = findByTestId(regularRoot, 'scales-workspace-shell');

    const wideRenderer = await renderAppAtSize(900, 1200);
    const wideRoot = wideRenderer.root;
    const wideTabText = findByTestId(wideRoot, 'main-tab-group:1').findByType('Text');
    const wideShell = findByTestId(wideRoot, 'scales-workspace-shell');

    expect(readStyleNumber(compactTabText.props.style, 'fontSize')).toBe(12);
    expect(readStyleNumber(regularTabText.props.style, 'fontSize')).toBe(16);
    expect(readStyleNumber(wideTabText.props.style, 'fontSize')).toBe(18);
    expect(readStyleNumber(compactShell.props.style, 'maxWidth')).toBeUndefined();
    expect(readStyleNumber(regularShell.props.style, 'maxWidth')).toBeUndefined();
    expect(readStyleNumber(wideShell.props.style, 'maxWidth')).toBe(1280);
  });

  it('keeps the workspace nav visible while the Scales results scroll internally', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderAppAtSize(900, 1200);
    const root = renderer.root;

    expect(findByTestId(root, 'workspace-scales-button')).toBeTruthy();
    expect(findByTestId(root, 'workspace-tabs-button')).toBeTruthy();
    expect(findScalesResultsScroll(root).props.nestedScrollEnabled).toBe(true);
  });

  it('scales the transposer output text up across compact, regular, and wide widths', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
    seedSavedTabs([
      {
        id: 'source',
        title: 'Source',
        inputText: '4 -4 5 -5',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
    ]);

    const compactRenderer = await renderAppAtSize(390, 844);
    const compactRoot = compactRenderer.root;
    goToTabs(compactRoot);
    await openLibraryTab(compactRoot, 'source');

    const regularRenderer = await renderAppAtSize(700, 1024);
    const regularRoot = regularRenderer.root;
    goToTabs(regularRoot);
    await openLibraryTab(regularRoot, 'source');

    const wideRenderer = await renderAppAtSize(900, 1200);
    const wideRoot = wideRenderer.root;
    goToTabs(wideRoot);
    await openLibraryTab(wideRoot, 'source');

    expect(readStyleNumber(findTransposerOutputTextNode(compactRoot).props.style, 'fontSize')).toBe(14);
    expect(readStyleNumber(findTransposerOutputTextNode(regularRoot).props.style, 'fontSize')).toBe(16);
    expect(readStyleNumber(findTransposerOutputTextNode(wideRoot).props.style, 'fontSize')).toBe(18);
  });

  it('shows flat spellings by default for harmonica and target key dropdowns', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    chooseHarmonicaKey(root, 11);

    expect(findDropdownByLabel(root, 'Harmonica key').props.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Db' })]),
    );
    expect(findDropdownByLabel(root, 'Harmonica key').props.options).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'C#' })]),
    );
    expect(findDropdownByLabel(root, 'Target Position/Key').props.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '2nd / Gb' }),
        expect.objectContaining({ label: '3rd / Db' }),
      ]),
    );
  });

  it('lets properties switch harmonica and target dropdown spellings to sharps', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    chooseHarmonicaKey(root, 11);
    chooseTargetPosition(root, '2nd / Gb');

    act(() => {
      findPressableByText(root, '⚙').props.onPress();
    });

    act(() => {
      findDropdownByLabel(root, 'Harp keys').props.onChange('sharp');
      findDropdownByLabel(root, 'Target keys').props.onChange('sharp');
    });

    act(() => {
      findPressableByText(root, '←').props.onPress();
    });

    expect(findDropdownByLabel(root, 'Harmonica key').props.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'C#' })]),
    );
    expect(findDropdownByLabel(root, 'Harmonica key').props.options).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'Db' })]),
    );
    expect(findDropdownByLabel(root, 'Target Position/Key').props.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '2nd / F#' }),
        expect.objectContaining({ label: '3rd / C#' }),
      ]),
    );
    expect(findDropdownByLabel(root, 'Target Position/Key').props.value).toBe('F#');
  });

  it('keeps the workspace nav visible while the library list scrolls internally', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
    seedSavedTabs(
      Array.from({ length: 12 }, (_, index) => ({
        id: `tab-${index}`,
        title: `Tab ${index + 1}`,
        inputText: '4 -4 5 -5',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
      })),
    );

    const renderer = await renderApp();
    const root = renderer.root;

    goToTabs(root);

    expect(findByTestId(root, 'workspace-scales-button')).toBeTruthy();
    expect(findByTestId(root, 'workspace-tabs-button')).toBeTruthy();
    expect(findSavedTabsScroll(root).props.nestedScrollEnabled).toBe(true);
  });

  it('renders transposed output inside a bounded inner scroll area', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
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

    goToTransposer(root);
    openLibraryFromTransposer(root);
    await openLibraryTab(root, 'source');

    const outputScroll = findTransposerOutputScroll(root);
    const boundedStyle = (outputScroll.props.style as Array<Record<string, unknown>>).find(
      (entry) => typeof entry?.maxHeight === 'number',
    );

    expect(outputScroll.props.nestedScrollEnabled).toBe(true);
    expect(boundedStyle?.maxHeight).toBeGreaterThan(120);
  });

  it('opening a saved tab from the library loads it into the transposer', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
    seedSavedTabs([
      {
        id: 'first',
        title: 'Amazing Grace',
        inputText: '4 -4',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
    ]);

    const renderer = await renderApp();
    const root = renderer.root;

    goToTransposer(root);
    openLibraryFromTransposer(root);
    expect(findAllText(root, 'Open').length).toBeGreaterThan(0);
    await openLibraryTab(root, 'first');

    expect(findAllText(root, 'Amazing Grace')).toHaveLength(0);
    expect(findAllText(root, 'Current tab: Amazing Grace').length).toBeGreaterThan(0);
    expect(readTransposerOutputText(root)).toBe('4 -4');
    expect(() => findByTestId(root, 'transposer-output-token:0')).not.toThrow();
  });

  it('returns to the transposer when switching away from Tabs after opening a source tab', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
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

    act(() => {
      findByTestId(root, 'workspace-scales-button').props.onPress();
    });

    expect(findAllText(root, 'Saved Tabs').length).toBe(0);

    goToTabs(root);

    expect(findAllText(root, 'Current tab: Source').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Choose Tab').length).toBeGreaterThan(0);
  });

  it('choose tab clears the active source and keeps Tabs on the library when revisiting', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
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

    act(() => {
      findByTestId(root, 'transposer-choose-tab-button').props.onPress();
    });

    expect(findAllText(root, 'Saved Tabs').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Current tab: Source').length).toBe(0);

    act(() => {
      findByTestId(root, 'workspace-scales-button').props.onPress();
    });

    goToTabs(root);

    expect(findAllText(root, 'Saved Tabs').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Current tab: Source').length).toBe(0);
  });

  it('steps octaves relative to the current display and base resets back to first position', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
    seedSavedTabs([
      {
        id: 'source',
        title: 'Source',
        inputText: '7 -8',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
    ]);

    const renderer = await renderApp();
    const root = renderer.root;

    goToTransposer(root);
    openLibraryFromTransposer(root);
    await openLibraryTab(root, 'source');

    expect(readTransposerOutputText(root)).toBe('7 -8');
    expect(findAllText(root, '1st / C').length).toBeGreaterThan(0);

    act(() => {
      findByTestId(root, 'transposer-octave-down-button').props.onPress();
    });

    expect(readTransposerOutputText(root)).toBe('4 -4');
    expect(findAllText(root, '1st / C').length).toBeGreaterThan(0);

    act(() => {
      findByTestId(root, 'transposer-octave-down-button').props.onPress();
    });

    expect(readTransposerOutputText(root)).toBe('1 -1');
    expect(findByTestId(root, 'transposer-octave-down-button').props.disabled).toBe(true);

    act(() => {
      findByTestId(root, 'transposer-octave-base-button').props.onPress();
    });

    expect(readTransposerOutputText(root)).toBe('7 -8');
    expect(findAllText(root, '1st / C').length).toBeGreaterThan(0);
  });

  it('base resets a non-first-position target back to first position on the current harmonica', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
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

    goToTransposer(root);
    openLibraryFromTransposer(root);
    await openLibraryTab(root, 'source');

    chooseTargetPosition(root, '2nd / G');

    expect(readTransposerOutputText(root)).not.toBe('4 -4');
    expect(findAllText(root, '2nd / G').length).toBeGreaterThan(0);

    act(() => {
      findByTestId(root, 'transposer-octave-base-button').props.onPress();
    });

    expect(readTransposerOutputText(root)).toBe('4 -4');
    expect(findAllText(root, '1st / C').length).toBeGreaterThan(0);
  });

  it('disables unavailable octave buttons based on the next step from the current display', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
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

    goToTransposer(root);
    openLibraryFromTransposer(root);
    await openLibraryTab(root, 'source');

    expect(findByTestId(root, 'transposer-octave-down-button').props.disabled).toBe(false);
    expect(findByTestId(root, 'transposer-octave-up-button').props.disabled).toBe(false);

    act(() => {
      findByTestId(root, 'transposer-octave-down-button').props.onPress();
    });

    expect(findByTestId(root, 'transposer-octave-down-button').props.disabled).toBe(true);

    act(() => {
      findByTestId(root, 'transposer-octave-down-button').props.onPress();
    });

    expect(findByTestId(root, 'transposer-octave-down-button').props.disabled).toBe(true);
  });

  it('resets the active output token when the octave display changes', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
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

    goToTransposer(root);
    openLibraryFromTransposer(root);
    await openLibraryTab(root, 'source');

    act(() => {
      findByTestId(root, 'transposer-output-token:1').props.onPress();
    });

    expect(
      (findByTestId(root, 'transposer-output-token:1').props.style as Array<Record<string, unknown>>).some(
        (entry) => entry?.borderColor === 'rgba(56, 189, 248, 0.45)' && entry?.borderWidth === 2,
      ),
    ).toBe(true);

    act(() => {
      findByTestId(root, 'transposer-octave-down-button').props.onPress();
    });

    expect(
      (findByTestId(root, 'transposer-output-token:0').props.style as Array<Record<string, unknown>>).some(
        (entry) => entry?.borderColor === 'rgba(56, 189, 248, 0.45)' && entry?.borderWidth === 2,
      ),
    ).toBe(true);
  });

  it('lets clicking a transposed output token move the active cursor', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
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

    goToTransposer(root);
    openLibraryFromTransposer(root);
    await openLibraryTab(root, 'source');

    const firstToken = findByTestId(root, 'transposer-output-token:0');
    const secondToken = findByTestId(root, 'transposer-output-token:1');

    expect(
      (firstToken.props.style as Array<Record<string, unknown>>).some(
        (entry) => entry?.borderColor === 'rgba(56, 189, 248, 0.45)' && entry?.borderWidth === 2,
      ),
    ).toBe(true);

    act(() => {
      secondToken.props.onPress();
    });

    expect(
      (findByTestId(root, 'transposer-output-token:0').props.style as Array<Record<string, unknown>>).some(
        (entry) => entry?.borderColor === 'rgba(56, 189, 248, 0.45)' && entry?.borderWidth === 2,
      ),
    ).toBe(false);
    expect(
      (findByTestId(root, 'transposer-output-token:1').props.style as Array<Record<string, unknown>>).some(
        (entry) => entry?.borderColor === 'rgba(56, 189, 248, 0.45)' && entry?.borderWidth === 2,
      ),
    ).toBe(true);
  });

  it('auto-scrolls the output when a newly active token is below the visible area', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
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

    goToTransposer(root);
    openLibraryFromTransposer(root);
    await openLibraryTab(root, 'source');

    measureTransposerOutput(root, 40);
    measureTransposerToken(root, 0, 0, 20);
    const secondToken = measureTransposerToken(root, 1, 80, 20);

    scrollToSpy.mockClear();

    act(() => {
      secondToken.props.onPress();
    });

    expect(scrollToSpy).toHaveBeenLastCalledWith({ y: 76, animated: true });
  });

  it('lets the transposer page control the shared listen state once a source tab is selected', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
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

    goToTransposer(root);
    openLibraryFromTransposer(root);
    await openLibraryTab(root, 'source');

    act(() => {
      findByTestId(root, 'transposer-listen-button').props.onPress();
    });

    expect(flattenTextChildren(findByTestId(root, 'transposer-listen-button').children).trim()).toBe(
      '🎤 Listen & Highlight Notes[On]',
    );
  });

  it('highlights the matching note on the main tab row while listening', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;
    const groups = buildTabsForScale({ rootPc: 0, scaleId: 'major' }, HARMONICA_KEYS[0].pc, 'apostrophe');
    const targetIndex = groups.findIndex((group) => group.midi === 69);

    expect(targetIndex).toBeGreaterThanOrEqual(0);

    await act(async () => {
      findPressableByText(root, '🎤 Listen & Highlight Notes').props.onPress();
      await Promise.resolve();
    });
    expect(flattenTextChildren(findPressableByText(root, '🎤 Listen & Highlight Notes').children).trim()).toBe(
      '🎤 Listen & Highlight Notes[On]',
    );

    act(() => {
      groups.forEach((_, index) => {
        findByTestId(root, `main-tab-group:${index}`).props.onLayout({
          nativeEvent: { layout: { x: index * 24, y: 0, width: 20, height: 20 } },
        });
      });
    });

    const matchedGroup = findByTestId(root, `main-tab-group:${targetIndex}`);
    const groupStyles = flattenStyle(matchedGroup.props.style);
    const caret = findByTestId(root, 'main-tab-caret');
    const caretStyles = flattenStyle(caret.props.style);

    expect(groupStyles.some((style: any) => style?.borderColor === '#16e05d')).toBe(false);
    expect(caretStyles.some((style: any) => style?.borderColor === '#16e05d')).toBe(true);
    expect(caretStyles.some((style: any) => style?.backgroundColor === 'rgba(22, 224, 93, 0.4)')).toBe(true);
  });

  it('library edit opens the editor with the saved text loaded', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
    seedSavedTabs([
      {
        id: 'edit-me',
        title: 'Edit Me',
        inputText: '4 -4 5',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
    ]);

    const renderer = await renderApp();
    const root = renderer.root;

    goToTransposer(root);
    openLibraryFromTransposer(root);
    await editLibraryTab(root, 'edit-me');

    expect(findByTestId(root, 'editor-close-button')).toBeTruthy();
    expect(findAllText(root, 'Cancel').length).toBeGreaterThan(0);
    expect(findAllText(root, 'X')).toHaveLength(0);
    expect(findTextInput(root).props.value).toBe('4 -4 5');
    expect(findAllText(root, 'Editing: Edit Me').length).toBeGreaterThan(0);
  });

  it('places cancel, save actions, and helper controls above the editor input', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    goToTabs(root);
    openCreateTab(root);

    expect(findAllText(root, 'Cancel').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Save').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Save As').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Helpers').length).toBeGreaterThan(0);

    const cancelOrder = findNodeOrder(root, (node: any) => node.props?.testID === 'editor-close-button');
    const saveOrder = findNodeOrder(root, (node: any) => node.props?.testID === 'editor-save-button');
    const cleanOrder = findNodeOrder(root, (node: any) => node.props?.testID === 'editor-clean-button');
    const editorInputOrder = findNodeOrder(root, (node: any) => node.type === 'TextInput');

    expect(cancelOrder).toBeGreaterThan(-1);
    expect(saveOrder).toBeGreaterThan(-1);
    expect(cleanOrder).toBeGreaterThan(-1);
    expect(editorInputOrder).toBeGreaterThan(-1);
    expect(cancelOrder).toBeLessThan(editorInputOrder);
    expect(saveOrder).toBeLessThan(editorInputOrder);
    expect(cleanOrder).toBeLessThan(editorInputOrder);
  });

  it('closing the editor opened from the library returns to the library', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
    seedSavedTabs([
      {
        id: 'edit-me',
        title: 'Edit Me',
        inputText: '4 -4 5',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
    ]);

    const renderer = await renderApp();
    const root = renderer.root;

    goToTabs(root);
    await editLibraryTab(root, 'edit-me');

    act(() => {
      findByTestId(root, 'editor-close-button').props.onPress();
    });

    expect(root.findAll((node: any) => node.props?.testID === 'editor-close-button')).toHaveLength(0);
    expect(findAllText(root, 'Saved Tabs').length).toBeGreaterThan(0);
  });

  it('closing the editor opened from the transposer returns to the transposer', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
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

    act(() => {
      findByTestId(root, 'transposer-edit-tab-button').props.onPress();
    });

    act(() => {
      findByTestId(root, 'editor-close-button').props.onPress();
    });

    expect(root.findAll((node: any) => node.props?.testID === 'editor-close-button')).toHaveLength(0);
    expect(findAllText(root, 'Current tab: Source').length).toBeGreaterThan(0);
  });

  it('saves a new editor tab to the library', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    goToTransposer(root);
    openCreateTab(root);

    act(() => {
      findTextInput(root).props.onChangeText('4 -4');
    });

    await act(async () => {
      findByTestId(root, 'editor-save-button').props.onPress();
      await Promise.resolve();
    });

    expect(findAllText(root, 'Save Tab').length).toBeGreaterThan(0);
    expect(findByTestId(root, 'save-tab-title-input')).toBeTruthy();

    await act(async () => {
      findByTestId(root, 'save-tab-title-input').props.onChangeText('Warmup');
      await Promise.resolve();
    });

    await act(async () => {
      findByTestId(root, 'save-tab-title-input').props.onChangeText('Warmup');
      await findByTestId(root, 'save-tab-confirm-button').props.onPressIn();
    });

    const storedLibrary = readSavedTabsFromStorage();
    expect(storedLibrary).toHaveLength(1);
    expect(storedLibrary[0]?.title).toBe('Warmup');
    expect(storedLibrary[0]?.inputText).toBe('4 -4');
    expect(root.findAll((node: any) => node.props?.testID === 'editor-close-button')).toHaveLength(0);
    expect(findAllText(root, 'Saved Tabs').length).toBeGreaterThan(0);
  });

  it('defaults the editor saved-context toggle off for new tabs', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    goToTabs(root);
    openCreateTab(root);

    expect(findByTestId(root, 'editor-save-context-toggle')).toBeTruthy();
    expect(findAllText(root, 'Save with key/position context').length).toBeGreaterThan(0);
    expect(root.findAll((node: any) => node.props?.testID === 'editor-context-harmonica-dropdown')).toHaveLength(0);
    expect(root.findAll((node: any) => node.props?.testID === 'editor-context-position-dropdown')).toHaveLength(0);

    act(() => {
      findByTestId(root, 'editor-save-context-toggle').props.onPress();
    });

    expect(findDropdownByTestId(root, 'editor-context-harmonica-dropdown').props.value).toBe(0);
    expect(findDropdownByTestId(root, 'editor-context-position-dropdown').props.value).toBe(1);
  });

  it('reopens saved context in the editor with the toggle on and saved-context dropdowns restored', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
    seedSavedTabs([
      {
        id: 'context-tab',
        title: 'Context tab',
        inputText: '4 -4',
        harmonicaPc: 0,
        positionNumber: 2,
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
    ]);

    const renderer = await renderApp();
    const root = renderer.root;

    goToTabs(root);
    await editLibraryTab(root, 'context-tab');

    expect(findByTestId(root, 'editor-save-context-toggle')).toBeTruthy();
    expect(findDropdownByTestId(root, 'editor-context-harmonica-dropdown').props.value).toBe(0);
    expect(findDropdownByTestId(root, 'editor-context-position-dropdown').props.value).toBe(2);
  });

  it('saves edited saved-context dropdown values with the tab', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    goToTabs(root);
    openCreateTab(root);

    act(() => {
      findTextInput(root).props.onChangeText('4 -4');
      findByTestId(root, 'editor-save-context-toggle').props.onPress();
    });

    act(() => {
      findDropdownByTestId(root, 'editor-context-harmonica-dropdown').props.onChange(5);
      findDropdownByTestId(root, 'editor-context-position-dropdown').props.onChange(3);
    });

    await act(async () => {
      findByTestId(root, 'editor-save-button').props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      findByTestId(root, 'save-tab-title-input').props.onChangeText('Keyed tab');
      await findByTestId(root, 'save-tab-confirm-button').props.onPress();
    });

    const storedLibrary = readSavedTabsFromStorage();
    expect(storedLibrary).toHaveLength(1);
    expect(storedLibrary[0]?.harmonicaPc).toBe(5);
    expect(storedLibrary[0]?.positionNumber).toBe(3);
  });

  it('edits a saved tab and re-saves it from the editor', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
    seedSavedTabs([
      {
        id: 'warmup',
        title: 'Warmup',
        inputText: '4 -4',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
    ]);

    const renderer = await renderApp();
    const root = renderer.root;

    goToTransposer(root);
    openLibraryFromTransposer(root);
    await editLibraryTab(root, 'warmup');

    act(() => {
      findTextInput(root).props.onChangeText('4 -4 5');
    });

    await act(async () => {
      findByTestId(root, 'editor-save-button').props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      await findByTestId(root, 'save-tab-confirm-button').props.onPress();
    });

    const storedLibrary = readSavedTabsFromStorage();
    expect(storedLibrary).toHaveLength(1);
    expect(storedLibrary[0]?.title).toBe('Warmup');
    expect(storedLibrary[0]?.inputText).toBe('4 -4 5');
    expect(root.findAll((node: any) => node.props?.testID === 'editor-close-button')).toHaveLength(0);
    expect(findAllText(root, 'Saved Tabs').length).toBeGreaterThan(0);
  });

  it('re-saving from the transposer editor returns to the transposer', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
    seedSavedTabs([
      {
        id: 'warmup',
        title: 'Warmup',
        inputText: '4 -4',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
    ]);

    const renderer = await renderApp();
    const root = renderer.root;

    goToTabs(root);
    await openLibraryTab(root, 'warmup');

    act(() => {
      findByTestId(root, 'transposer-edit-tab-button').props.onPress();
    });

    act(() => {
      findTextInput(root).props.onChangeText('4 -4 5');
    });

    await act(async () => {
      findByTestId(root, 'editor-save-button').props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      await findByTestId(root, 'save-tab-confirm-button').props.onPress();
    });

    expect(root.findAll((node: any) => node.props?.testID === 'editor-close-button')).toHaveLength(0);
    expect(findAllText(root, 'Current tab: Warmup').length).toBeGreaterThan(0);
  });

  it('lets a saved tab branch into a new record with Save As from the editor', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
    seedSavedTabs([
      {
        id: 'original',
        title: 'Original',
        inputText: '4 -4',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
    ]);

    const renderer = await renderApp();
    const root = renderer.root;

    goToTransposer(root);
    openLibraryFromTransposer(root);
    await editLibraryTab(root, 'original');

    act(() => {
      findTextInput(root).props.onChangeText('4 -4 5');
    });

    await act(async () => {
      findByTestId(root, 'editor-save-as-button').props.onPress();
      await Promise.resolve();
    });

    expect(findAllText(root, 'Save As New Tab').length).toBeGreaterThan(0);
    expect(findByTestId(root, 'save-tab-title-input')).toBeTruthy();

    await act(async () => {
      findByTestId(root, 'save-tab-title-input').props.onChangeText('Original copy');
      await Promise.resolve();
    });

    await act(async () => {
      await findByTestId(root, 'save-tab-confirm-button').props.onPress();
    });

    const storedLibrary = readSavedTabsFromStorage();
    expect(storedLibrary).toHaveLength(2);
    expect(storedLibrary.map((tab) => tab.title).sort()).toEqual(['Original', 'Original copy']);
    expect(storedLibrary.find((tab) => tab.title === 'Original')?.inputText).toBe('4 -4');
    expect(storedLibrary.find((tab) => tab.title === 'Original copy')?.inputText).toBe('4 -4 5');
    expect(root.findAll((node: any) => node.props?.testID === 'editor-close-button')).toHaveLength(0);
    expect(findAllText(root, 'Saved Tabs').length).toBeGreaterThan(0);
  });

  it('prompts when opening a saved tab whose context mismatches the current selection', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
    seedSavedTabs([
      {
        id: 'context-tab',
        title: 'Context tab',
        inputText: '4 -4',
        harmonicaPc: 0,
        positionNumber: 2,
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
    ]);

    const renderer = await renderApp();
    const root = renderer.root;

    chooseHarmonicaKey(root, 5);
    goToTabs(root);
    await openLibraryTab(root, 'context-tab');
    await act(async () => {
      await Promise.resolve();
    });

    expect(findByTestId(root, 'saved-tab-context-modal')).toBeTruthy();
    expect(findAllText(root, 'Use saved: C harp • 2nd / G').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Keep F harp: 3rd / G').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Keep current selection and load').length).toBeGreaterThan(0);
  });

  it('hides the workspace switcher while the editor overlay is open', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    goToTabs(root);
    openCreateTab(root);

    expect(root.findAll((node: any) => node.props?.testID === 'workspace-scales-button')).toHaveLength(0);
    expect(root.findAll((node: any) => node.props?.testID === 'workspace-tabs-button')).toHaveLength(0);
  });

  it('prompts before closing the editor with unsaved changes and can discard them', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    goToTabs(root);
    openCreateTab(root);

    act(() => {
      findTextInput(root).props.onChangeText('4 -4');
    });

    act(() => {
      findByTestId(root, 'editor-close-button').props.onPress();
    });

    expect(findByTestId(root, 'editor-close-discard-button')).toBeTruthy();
    expect(findAllText(root, 'Discard').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Save').length).toBeGreaterThan(0);

    act(() => {
      findPressableByText(findByTestId(root, 'editor-close-confirm-modal'), 'Cancel').props.onPress();
    });

    expect(root.findAll((node: any) => node.props?.testID === 'editor-close-discard-button')).toHaveLength(0);
    expect(findTextInput(root).props.value).toBe('4 -4');

    act(() => {
      findByTestId(root, 'editor-close-button').props.onPress();
    });

    act(() => {
      findByTestId(root, 'editor-close-discard-button').props.onPress();
    });

    expect(root.findAll((node: any) => node.props?.testID === 'editor-close-button')).toHaveLength(0);
    expect(findAllText(root, 'Saved Tabs').length).toBeGreaterThan(0);
  });

  it('lets the save dialog cancel and return focus to the editor', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    goToTabs(root);
    openCreateTab(root);

    act(() => {
      findTextInput(root).props.onChangeText('4 -4');
    });

    await act(async () => {
      findByTestId(root, 'editor-save-button').props.onPress();
      await Promise.resolve();
    });

    expect(findAllText(root, 'Save Tab').length).toBeGreaterThan(0);
    expect(findByTestId(root, 'save-tab-title-input')).toBeTruthy();

    act(() => {
      findPressableByText(findByTestId(root, 'save-tab-modal'), 'Cancel').props.onPress();
    });

    expect(root.findAll((node: any) => node.props?.testID === 'save-tab-title-input')).toHaveLength(0);
    expect(findByTestId(root, 'editor-close-button')).toBeTruthy();
    expect(findTextInput(root).props.value).toBe('4 -4');
  });

  it('keeps Clean Input working after moving it above the editor field', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    goToTabs(root);
    openCreateTab(root);

    act(() => {
      findTextInput(root).props.onChangeText('Song:\t5    5    5   6  5  -4');
    });

    act(() => {
      findByTestId(root, 'editor-clean-button').props.onPress();
    });

    expect(findTextInput(root).props.value).toBe('5 5 5 6 5 -4');
  });

  it('can save and close the editor with unsaved changes', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    goToTabs(root);
    openCreateTab(root);

    act(() => {
      findTextInput(root).props.onChangeText('6 -6');
    });

    act(() => {
      findByTestId(root, 'editor-close-button').props.onPress();
    });

    await act(async () => {
      findByTestId(root, 'editor-close-save-button').props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      findByTestId(root, 'save-tab-title-input').props.onChangeText('Saved on close');
      await Promise.resolve();
    });

    await act(async () => {
      await findByTestId(root, 'save-tab-confirm-button').props.onPress();
    });

    expect(root.findAll((node: any) => node.props?.testID === 'editor-close-button')).toHaveLength(0);
    expect(findAllText(root, 'Saved Tabs').length).toBeGreaterThan(0);

    const storedLibrary = readSavedTabsFromStorage();
    expect(storedLibrary).toHaveLength(1);
    expect(storedLibrary[0]?.title).toBe('Saved on close');
  });


  it('clears the transposer back to its empty output state when deleting the current source tab', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 5 });
    seedSavedTabs([
      {
        id: 'delete-me',
        title: 'Delete me',
        inputText: '4 -4 5',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
    ]);

    const renderer = await renderApp();
    const root = renderer.root;

    goToTransposer(root);
    openLibraryFromTransposer(root);
    await openLibraryTab(root, 'delete-me');

    openLibraryFromTransposer(root);

    await act(async () => {
      findByTestId(root, 'saved-tab-delete:delete-me').props.onPress();
      await Promise.resolve();
    });

    expect(findAllText(root, 'Saved Tabs').length).toBeGreaterThan(0);
    expect(readSavedTabsFromStorage()).toHaveLength(0);
  });

});
