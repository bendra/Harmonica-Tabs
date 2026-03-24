import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';
import { resetReactNativeMocks, scrollToSpy } from './react-native.mock';
import { parseSavedTabLibrary, SAVED_TAB_LIBRARY_STORAGE_KEY } from '../../src/logic/saved-tab-library';

const { asyncStorageMock, asyncStorageValues } = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    asyncStorageValues: values,
    asyncStorageMock: {
      getItem: vi.fn(async (key: string) => values.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        values.delete(key);
      }),
    },
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: asyncStorageMock,
}));

const { default: App } = await import('../../App');

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

function findAllText(root: any, text: string) {
  return root.findAll((node: any) => node.type === 'Text' && flattenTextChildren(node.children).trim() === text);
}

function findTextInput(root: any) {
  return root.find((node: any) => node.type === 'TextInput');
}

function findTransposerOutputScroll(root: any) {
  return root.find((node: any) => node.type === 'ScrollView' && node.props.testID === 'transposer-output-scroll');
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

function findVisibleModal(root: any) {
  return root.findAll((node: any) => node.type === 'Modal')[0] ?? null;
}

function findByTestId(root: any, testID: string) {
  return root.find((node: any) => node.props?.testID === testID);
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
    findByTestId(root, `saved-tab-open:${id}`).props.onPress();
    await Promise.resolve();
  });
}

function chooseTargetPosition(root: any, label: string) {
  act(() => {
    findDropdownByLabel(root, 'Target Position/Key').props.onChange(label.split(' - ')[1]);
  });
}

async function editLibraryTab(root: any, id: string) {
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
  });

  return renderer;
}

describe('App navigation', () => {
  beforeEach(() => {
    resetReactNativeMocks();
    asyncStorageValues.clear();
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
    expect(findAllText(root, 'Transposed Tab').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Current tab: Amazing Grace').length).toBeGreaterThan(0);
    expect(() => findByTestId(root, 'transposer-output-token:0')).not.toThrow();
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
    expect(findAllText(root, '1 - C').length).toBeGreaterThan(0);

    act(() => {
      findByTestId(root, 'transposer-octave-down-button').props.onPress();
    });

    expect(readTransposerOutputText(root)).toBe('4 -4');
    expect(findAllText(root, '1 - C').length).toBeGreaterThan(0);

    act(() => {
      findByTestId(root, 'transposer-octave-down-button').props.onPress();
    });

    expect(readTransposerOutputText(root)).toBe('1 -1');
    expect(findByTestId(root, 'transposer-octave-down-button').props.disabled).toBe(true);

    act(() => {
      findByTestId(root, 'transposer-octave-base-button').props.onPress();
    });

    expect(readTransposerOutputText(root)).toBe('7 -8');
    expect(findAllText(root, '1 - C').length).toBeGreaterThan(0);
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

    chooseTargetPosition(root, '2 - G');

    expect(readTransposerOutputText(root)).not.toBe('4 -4');
    expect(findAllText(root, '2 - G').length).toBeGreaterThan(0);

    act(() => {
      findByTestId(root, 'transposer-octave-base-button').props.onPress();
    });

    expect(readTransposerOutputText(root)).toBe('4 -4');
    expect(findAllText(root, '1 - C').length).toBeGreaterThan(0);
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

    expect(flattenTextChildren(findByTestId(root, 'transposer-listen-button').children).trim()).toBe('Stop');
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

    expect(findTextInput(root).props.value).toBe('4 -4 5');
    expect(findAllText(root, 'Editing: Edit Me').length).toBeGreaterThan(0);
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

    await act(async () => {
      findByTestId(root, 'save-tab-title-input').props.onChangeText('Warmup');
      await Promise.resolve();
    });

    await act(async () => {
      findByTestId(root, 'save-tab-title-input').props.onChangeText('Warmup');
      await findByTestId(root, 'save-tab-confirm-button').props.onPress();
    });

    const storedLibrary = parseSavedTabLibrary(asyncStorageValues.get(SAVED_TAB_LIBRARY_STORAGE_KEY) ?? null);
    expect(storedLibrary.tabs).toHaveLength(1);
    expect(storedLibrary.tabs[0]?.title).toBe('Warmup');
    expect(storedLibrary.tabs[0]?.inputText).toBe('4 -4');
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

    const storedLibrary = parseSavedTabLibrary(asyncStorageValues.get(SAVED_TAB_LIBRARY_STORAGE_KEY) ?? null);
    expect(storedLibrary.tabs).toHaveLength(1);
    expect(storedLibrary.tabs[0]?.title).toBe('Warmup');
    expect(storedLibrary.tabs[0]?.inputText).toBe('4 -4 5');
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

    await act(async () => {
      findByTestId(root, 'save-tab-title-input').props.onChangeText('Original copy');
      await Promise.resolve();
    });

    await act(async () => {
      await findByTestId(root, 'save-tab-confirm-button').props.onPress();
    });

    const storedLibrary = parseSavedTabLibrary(asyncStorageValues.get(SAVED_TAB_LIBRARY_STORAGE_KEY) ?? null);
    expect(storedLibrary.tabs).toHaveLength(2);
    expect(storedLibrary.tabs.map((tab) => tab.title).sort()).toEqual(['Original', 'Original copy']);
    expect(storedLibrary.tabs.find((tab) => tab.title === 'Original')?.inputText).toBe('4 -4');
    expect(storedLibrary.tabs.find((tab) => tab.title === 'Original copy')?.inputText).toBe('4 -4 5');
  });

  it('prompts before starting a new draft when the editor has unsaved changes and can discard them', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    goToTransposer(root);
    openCreateTab(root);

    act(() => {
      findTextInput(root).props.onChangeText('4 -4');
    });

    act(() => {
      findByTestId(root, 'editor-new-button').props.onPress();
    });

    expect(findAllText(root, 'Unsaved changes').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Discard and New').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Save Then New').length).toBeGreaterThan(0);

    act(() => {
      findPressableByText(root, 'Cancel').props.onPress();
    });

    expect(findTextInput(root).props.value).toBe('4 -4');

    act(() => {
      findByTestId(root, 'editor-new-button').props.onPress();
    });

    act(() => {
      findByTestId(root, 'discard-and-new-button').props.onPress();
    });

    expect(findTextInput(root).props.value).toBe('');
  });

  it('can save the current editor work and then start a new blank draft', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    goToTransposer(root);
    openCreateTab(root);

    act(() => {
      findTextInput(root).props.onChangeText('6 -6');
    });

    act(() => {
      findByTestId(root, 'editor-new-button').props.onPress();
    });

    await act(async () => {
      findByTestId(root, 'save-then-new-button').props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      findByTestId(root, 'save-tab-title-input').props.onChangeText('New draft source');
      await Promise.resolve();
    });

    await act(async () => {
      await findByTestId(root, 'save-tab-confirm-button').props.onPress();
    });

    expect(findTextInput(root).props.value).toBe('');

    const storedLibrary = parseSavedTabLibrary(asyncStorageValues.get(SAVED_TAB_LIBRARY_STORAGE_KEY) ?? null);
    expect(storedLibrary.tabs).toHaveLength(1);
    expect(storedLibrary.tabs[0]?.title).toBe('New draft source');
    expect(storedLibrary.tabs[0]?.inputText).toBe('6 -6');
  });

  it('prompts before opening another saved tab over editor changes and can save then open', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });
    seedSavedTabs([
      {
        id: 'first',
        title: 'First',
        inputText: '4 -4',
        createdAt: '2026-03-17T00:00:00.000Z',
        updatedAt: '2026-03-17T00:00:00.000Z',
      },
      {
        id: 'second',
        title: 'Second',
        inputText: '5 -5',
        createdAt: '2026-03-17T01:00:00.000Z',
        updatedAt: '2026-03-17T01:00:00.000Z',
      },
    ]);

    const renderer = await renderApp();
    const root = renderer.root;

    goToTransposer(root);
    openCreateTab(root);

    act(() => {
      findTextInput(root).props.onChangeText('6 -6');
    });

    act(() => {
      findByTestId(root, 'editor-library-button').props.onPress();
    });

    await act(async () => {
      findByTestId(root, 'saved-tab-edit:first').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(findVisibleModal(root)).not.toBeNull();
    expect(findAllText(root, 'Unsaved changes').length).toBeGreaterThan(0);

    await act(async () => {
      findPressableByText(root, 'Save Then Open').props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      findByTestId(root, 'save-tab-title-input').props.onChangeText('Draft before load');
      await Promise.resolve();
    });

    await act(async () => {
      await findByTestId(root, 'save-tab-confirm-button').props.onPress();
    });

    expect(findTextInput(root).props.value).toBe('4 -4');

    const storedLibrary = parseSavedTabLibrary(asyncStorageValues.get(SAVED_TAB_LIBRARY_STORAGE_KEY) ?? null);
    expect(storedLibrary.tabs.map((tab) => tab.title).sort()).toEqual(['Draft before load', 'First', 'Second']);
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
    expect(parseSavedTabLibrary(asyncStorageValues.get(SAVED_TAB_LIBRARY_STORAGE_KEY) ?? null).tabs).toHaveLength(0);
  });

});
