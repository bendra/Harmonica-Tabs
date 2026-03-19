import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';
import { resetReactNativeMocks, scrollToSpy } from './react-native.mock';
import { parseSavedTabLibrary, SAVED_TAB_LIBRARY_STORAGE_KEY } from '../../src/logic/saved-tab-library';

const readClipboardTextMock = vi.fn();
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

vi.mock('../../src/logic/transposer-clipboard', () => ({
  readClipboardText: readClipboardTextMock,
}));

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

function findAllText(root: any, text: string) {
  return root.findAll((node: any) => node.type === 'Text' && flattenTextChildren(node.children).trim() === text);
}

function findTextInput(root: any) {
  return root.find((node: any) => node.type === 'TextInput');
}

function findTransposerInputShell(root: any) {
  return root.find((node: any) => node.type === 'Pressable' && node.props.testID === 'transposer-input-shell');
}

function findAllTransposerInputShells(root: any) {
  return root.findAll((node: any) => node.type === 'Pressable' && node.props.testID === 'transposer-input-shell');
}

function findTransposerOutputScroll(root: any) {
  return root.find((node: any) => node.type === 'ScrollView' && node.props.testID === 'transposer-output-scroll');
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

function setTransposerOutputScrollY(root: any, y: number) {
  const outputScroll = findTransposerOutputScroll(root);

  act(() => {
    outputScroll.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y } } });
  });
}

function findVisibleModal(root: any) {
  return root.findAll((node: any) => node.type === 'Modal')[0] ?? null;
}

function findByTestId(root: any, testID: string) {
  return root.find((node: any) => node.props?.testID === testID);
}

function findModalBackdropPressable(root: any) {
  return root.findAll(
    (node: any) => node.type === 'Pressable' && typeof node.props.onPress === 'function' && node.children.length === 0,
  )[0];
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

function switchToCustomTabPad(root: any) {
  const gearButton = findPressableByText(root, '⚙');

  act(() => {
    gearButton.props.onPress();
  });

  const customPadButton = findPressableByText(root, '○ Custom Tab Pad');

  act(() => {
    customPadButton.props.onPress();
  });

  const backButton = findPressableByText(root, '←');

  act(() => {
    backButton.props.onPress();
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
    readClipboardTextMock.mockReset();
    readClipboardTextMock.mockResolvedValue('');
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

  it('restores the transposer pager page after leaving and dismissing properties', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    const transposerTab = findPressableByText(root, 'Transposer');

    act(() => {
      transposerTab.props.onPress();
    });

    expect(scrollToSpy).toHaveBeenLastCalledWith({ x: 360, animated: true });

    const gearButton = findPressableByText(root, '⚙');
    act(() => {
      gearButton.props.onPress();
    });

    expect(() => root.find((node: any) => node.type === 'Text' && flattenTextChildren(node.children) === 'Properties')).not.toThrow();

    const backButton = findPressableByText(root, '←');
    act(() => {
      backButton.props.onPress();
    });

    expect(() => findByTestId(root, 'transposer-listen-button')).not.toThrow();
    expect(scrollToSpy).toHaveBeenLastCalledWith({ x: 360, animated: false });
  });

  it('does not crash when debug is enabled in properties before returning to the transposer screen', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    const transposerTab = findPressableByText(root, 'Transposer');

    act(() => {
      transposerTab.props.onPress();
    });

    const gearButton = findPressableByText(root, '⚙');

    act(() => {
      gearButton.props.onPress();
    });

    const showDebugButton = findPressableByText(root, 'Show debug');

    act(() => {
      showDebugButton.props.onPress();
    });

    const backButton = findPressableByText(root, '←');

    expect(() => {
      act(() => {
        backButton.props.onPress();
      });
    }).not.toThrow();

    expect(() => findByTestId(root, 'transposer-listen-button')).not.toThrow();
  });

  it('shows the shared debug panel on the transposer instead of the temporary pad-event log', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 5 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    const transposerTab = findPressableByText(root, 'Transposer');

    act(() => {
      transposerTab.props.onPress();
    });

    const gearButton = findPressableByText(root, '⚙');

    act(() => {
      gearButton.props.onPress();
    });

    const showDebugButton = findPressableByText(root, 'Show debug');

    act(() => {
      showDebugButton.props.onPress();
    });

    const backButton = findPressableByText(root, '←');

    act(() => {
      backButton.props.onPress();
    });

    expect(findAllText(root, 'Debug Panel').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Transposer Pad Debug')).toHaveLength(0);
    expect(findAllText(root, 'RMS: 0.0000 · Conf: 0.00 · Hz: —').length).toBeGreaterThan(0);
  });

  it('defaults touch-first web to the native keyboard and exposes the keyboard setting in properties', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 5 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    const gearButton = findPressableByText(root, '⚙');

    act(() => {
      gearButton.props.onPress();
    });

    expect(findAllText(root, 'Keyboard').length).toBeGreaterThan(0);
    expect(findAllText(root, '○ Custom Tab Pad').length).toBeGreaterThan(0);
    expect(findAllText(root, '◉ Native Keyboard').length).toBeGreaterThan(0);
  });

  it('lets touch-first web switch the transposer to the custom tab pad from properties', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 5 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    switchToCustomTabPad(root);

    expect(
      findAllText(
        root,
        'Custom tab pad is active. Use Paste in the pad for clipboard text, or switch to Native Keyboard in Settings for the browser edit menu.',
      ).length,
    ).toBeGreaterThan(0);
    expect(findAllTransposerInputShells(root)).toHaveLength(1);
  });

  it('keeps desktop-style web on the native keyboard unless properties changes it', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;

    expect(
      findAllText(
        root,
        'Custom tab pad is active. Use Paste in the pad for clipboard text, or switch to Native Keyboard in Settings for the browser edit menu.',
      ),
    ).toHaveLength(0);
    expect(findAllText(root, 'Paste')).toHaveLength(0);
    expect(findAllTransposerInputShells(root)).toHaveLength(0);
  });

  it('renders transposed output inside a capped inner scroll area', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    const outputScroll = findTransposerOutputScroll(root);
    const maxHeightStyle = (outputScroll.props.style as Array<Record<string, unknown>>).find(
      (entry) => typeof entry?.maxHeight === 'number',
    );

    expect(outputScroll.props.nestedScrollEnabled).toBe(true);
    expect(maxHeightStyle?.maxHeight).toBe(256);
  });

  it('lets clicking a transposed output token move the active cursor', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;

    act(() => {
      findTextInput(root).props.onChangeText('4 -4');
    });

    const firstToken = findByTestId(root, 'transposer-output-token:0');
    const secondToken = findByTestId(root, 'transposer-output-token:1');

    expect(
      (firstToken.props.style as Array<Record<string, unknown>>).some(
        (entry) => entry?.borderColor === 'rgba(56, 189, 248, 0.45)' && entry?.borderWidth === 2,
      ),
    ).toBe(
      true,
    );

    act(() => {
      secondToken.props.onPress();
    });

    const updatedFirstToken = findByTestId(root, 'transposer-output-token:0');
    const updatedSecondToken = findByTestId(root, 'transposer-output-token:1');

    expect(
      (updatedFirstToken.props.style as Array<Record<string, unknown>>).some(
        (entry) => entry?.borderColor === 'rgba(56, 189, 248, 0.45)' && entry?.borderWidth === 2,
      ),
    ).toBe(false);
    expect(
      (updatedSecondToken.props.style as Array<Record<string, unknown>>).some(
        (entry) => entry?.borderColor === 'rgba(56, 189, 248, 0.45)' && entry?.borderWidth === 2,
      ),
    ).toBe(true);
  });

  it('auto-scrolls the output when a newly active token is below the visible area', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;

    act(() => {
      findTextInput(root).props.onChangeText('4 -4');
    });

    measureTransposerOutput(root, 40);
    measureTransposerToken(root, 0, 0, 20);
    const secondToken = measureTransposerToken(root, 1, 80, 20);

    scrollToSpy.mockClear();

    act(() => {
      secondToken.props.onPress();
    });

    expect(scrollToSpy).toHaveBeenLastCalledWith({ y: 76, animated: true });
  });

  it('does not auto-scroll when the active token is already visible', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;

    act(() => {
      findTextInput(root).props.onChangeText('4 -4');
    });

    measureTransposerOutput(root, 120);
    measureTransposerToken(root, 0, 0, 20);
    const secondToken = measureTransposerToken(root, 1, 40, 20);

    scrollToSpy.mockClear();

    act(() => {
      secondToken.props.onPress();
    });

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it('resets the active transposer cursor when the transposed output changes', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;

    act(() => {
      findTextInput(root).props.onChangeText('4 -4');
    });

    act(() => {
      findByTestId(root, 'transposer-output-token:1').props.onPress();
    });

    act(() => {
      findTextInput(root).props.onChangeText('4 -4 5');
    });

    const firstToken = findByTestId(root, 'transposer-output-token:0');
    const secondToken = findByTestId(root, 'transposer-output-token:1');

    expect(
      (firstToken.props.style as Array<Record<string, unknown>>).some(
        (entry) => entry?.borderColor === 'rgba(56, 189, 248, 0.45)' && entry?.borderWidth === 2,
      ),
    ).toBe(
      true,
    );
    expect(
      (secondToken.props.style as Array<Record<string, unknown>>).some(
        (entry) => entry?.borderColor === 'rgba(56, 189, 248, 0.45)' && entry?.borderWidth === 2,
      ),
    ).toBe(
      false,
    );
  });

  it('scrolls back up when output changes and the reset token is above the visible area', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;

    act(() => {
      findTextInput(root).props.onChangeText('4 -4');
    });

    measureTransposerOutput(root, 40);
    measureTransposerToken(root, 0, 0, 20);
    measureTransposerToken(root, 1, 80, 20);
    setTransposerOutputScrollY(root, 80);

    scrollToSpy.mockClear();

    act(() => {
      findTextInput(root).props.onChangeText('4 -4 5');
    });

    measureTransposerToken(root, 0, 0, 20);

    expect(scrollToSpy).toHaveBeenLastCalledWith({ y: 0, animated: true });
  });

  it('lets the transposer page control the shared listen state', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    let renderer: any;

    await act(async () => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    const listenButton = findByTestId(root, 'transposer-listen-button');

    expect(flattenTextChildren(listenButton.children).trim()).toBe('Listen');

    await act(async () => {
      await listenButton.props.onPress();
    });

    const updatedButton = findByTestId(root, 'transposer-listen-button');

    expect(flattenTextChildren(updatedButton.children).trim()).toBe('Stop');
  });

  it('lets desktop-style web switch to the custom tab pad from properties', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    const gearButton = findPressableByText(root, '⚙');

    act(() => {
      gearButton.props.onPress();
    });

    const customPadButton = findPressableByText(root, '○ Custom Tab Pad');

    act(() => {
      customPadButton.props.onPress();
    });

    const backButton = findPressableByText(root, '←');

    act(() => {
      backButton.props.onPress();
    });

    expect(findAllTransposerInputShells(root)).toHaveLength(1);

    const inputShell = findTransposerInputShell(root);

    act(() => {
      inputShell.props.onPress();
    });

    expect(findVisibleModal(root)).not.toBeNull();
  });

  it('does not immediately reopen the custom tab pad after tapping outside it', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 5 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    switchToCustomTabPad(root);
    const inputShell = findTransposerInputShell(root);
    const textInput = findTextInput(root);

    act(() => {
      inputShell.props.onPress();
    });

    expect(findVisibleModal(root)).not.toBeNull();

    const overlayPressable = findModalBackdropPressable(root);

    act(() => {
      overlayPressable.props.onPress();
    });

    expect(findVisibleModal(root)).toBeNull();

    act(() => {
      textInput.props.onBlur();
    });

    expect(findVisibleModal(root)).toBeNull();

    act(() => {
      inputShell.props.onPress();
    });

    expect(findVisibleModal(root)).not.toBeNull();
  });

  it('does not immediately reopen the custom tab pad after pressing Done', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 5 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    switchToCustomTabPad(root);
    const inputShell = findTransposerInputShell(root);
    const textInput = findTextInput(root);

    act(() => {
      inputShell.props.onPress();
    });

    expect(findVisibleModal(root)).not.toBeNull();

    const doneButton = findPressableByText(root, 'Done');

    act(() => {
      doneButton.props.onPress();
    });

    expect(findVisibleModal(root)).toBeNull();

    act(() => {
      textInput.props.onBlur();
    });

    expect(findVisibleModal(root)).toBeNull();
  });

  it('keeps the custom tab pad open when web blur fires immediately after opening', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 5 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    switchToCustomTabPad(root);
    const inputShell = findTransposerInputShell(root);
    const textInput = findTextInput(root);

    act(() => {
      inputShell.props.onPress();
    });

    expect(findVisibleModal(root)).not.toBeNull();

    act(() => {
      textInput.props.onBlur({ nativeEvent: { relatedTarget: null } });
    });

    expect(findVisibleModal(root)).not.toBeNull();
  });

  it('keeps the custom tab pad open when web blur targets a DOM element after opening', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 5 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    switchToCustomTabPad(root);
    const inputShell = findTransposerInputShell(root);
    const textInput = findTextInput(root);

    act(() => {
      inputShell.props.onPress();
    });

    expect(findVisibleModal(root)).not.toBeNull();

    act(() => {
      textInput.props.onBlur({ nativeEvent: { relatedTarget: { tagName: 'DIV' } } });
    });

    expect(findVisibleModal(root)).not.toBeNull();
  });

  it('closes the custom tab pad when leaving the main screen and keeps it closed on return', () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 5 });

    let renderer: any;

    act(() => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    switchToCustomTabPad(root);
    const inputShell = findTransposerInputShell(root);

    act(() => {
      inputShell.props.onPress();
    });

    expect(findVisibleModal(root)).not.toBeNull();

    const gearButton = findPressableByText(root, '⚙');

    act(() => {
      gearButton.props.onPress();
    });

    expect(findVisibleModal(root)).toBeNull();

    const backButton = findPressableByText(root, '←');

    act(() => {
      backButton.props.onPress();
    });

    expect(findVisibleModal(root)).toBeNull();
  });

  it('pastes clipboard text into the transposer input and keeps the custom pad open', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 5 });
    readClipboardTextMock.mockResolvedValue("4 -3’ +5°\nabc_%");

    let renderer: any;

    await act(async () => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    switchToCustomTabPad(root);
    const inputShell = findTransposerInputShell(root);

    await act(async () => {
      inputShell.props.onPress();
    });

    expect(findVisibleModal(root)).not.toBeNull();

    const pasteButton = findPressableByText(root, 'Paste');

    await act(async () => {
      await pasteButton.props.onPress();
    });

    expect(findTextInput(root).props.value).toBe("4 -3' +5°\n");
    expect(findVisibleModal(root)).not.toBeNull();
    expect(findAllText(root, 'Clipboard is empty.')).toHaveLength(0);
  });

  it('shows a paste error when clipboard access fails in custom-pad mode', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 5 });
    readClipboardTextMock.mockRejectedValue(new Error('Clipboard access is unavailable in this browser.'));

    let renderer: any;

    await act(async () => {
      renderer = TestRenderer.create(<App />);
    });

    const root = renderer!.root;
    switchToCustomTabPad(root);
    const inputShell = findTransposerInputShell(root);

    await act(async () => {
      inputShell.props.onPress();
    });

    const pasteButton = findPressableByText(root, 'Paste');

    await act(async () => {
      await pasteButton.props.onPress();
    });

    expect(findAllText(root, 'Clipboard access is unavailable in this browser.')).toHaveLength(1);
    expect(findVisibleModal(root)).not.toBeNull();
    expect(findTextInput(root).props.value).toBe('');
  });

  it('saves a transposer input tab and loads it without changing direction', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    act(() => {
      findTextInput(root).props.onChangeText('1');
    });

    await act(async () => {
      findPressableByText(root, 'Save').props.onPress();
    });

    await act(async () => {
      findByTestId(root, 'save-tab-title-input').props.onChangeText('Saved melody');
      await findByTestId(root, 'save-tab-confirm-button').props.onPress();
    });

    act(() => {
      findPressableByText(root, 'Library').props.onPress();
    });

    await act(async () => {
      findPressableByText(root, 'Load').props.onPress();
      await Promise.resolve();
    });

    expect(findTextInput(root).props.value).toBe('1');
    expect(findAllText(root, '◉ Up').length).toBeGreaterThan(0);
  });

  it('auto-selects up in first position when only the upper octave is fully playable', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    act(() => {
      findTextInput(root).props.onChangeText('1');
    });

    expect(findAllText(root, '◉ Up').length).toBeGreaterThan(0);
  });

  it('lets first position switch to an up-octave attempt manually', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    act(() => {
      findTextInput(root).props.onChangeText('4 -4');
    });

    act(() => {
      findPressableByText(root, '○ Up').props.onPress();
    });

    expect(findAllText(root, '◉ Up').length).toBeGreaterThan(0);
    expect(findAllText(root, '◉ Down')).toHaveLength(0);
  });

  it('edits a loaded saved tab and re-saves it', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    act(() => {
      findTextInput(root).props.onChangeText('4 -4');
    });

    await act(async () => {
      findPressableByText(root, 'Save').props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      findByTestId(root, 'save-tab-title-input').props.onChangeText('Warmup');
      await Promise.resolve();
    });

    await act(async () => {
      await findByTestId(root, 'save-tab-confirm-button').props.onPress();
    });

    act(() => {
      findTextInput(root).props.onChangeText('4 -4 5');
    });

    await act(async () => {
      findPressableByText(root, 'Re-save').props.onPress();
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

  it('lets a loaded saved tab branch into a new record with Save As', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    asyncStorageValues.set(
      SAVED_TAB_LIBRARY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tabs: [
          {
            id: 'original',
            title: 'Original',
            inputText: '4 -4',
            createdAt: '2026-03-17T00:00:00.000Z',
            updatedAt: '2026-03-17T00:00:00.000Z',
          },
        ],
      }),
    );

    const renderer = await renderApp();
    const root = renderer.root;

    act(() => {
      findPressableByText(root, 'Library').props.onPress();
    });

    await act(async () => {
      findByTestId(root, 'saved-tab-load:original').props.onPress();
      await Promise.resolve();
    });

    act(() => {
      findTextInput(root).props.onChangeText('4 -4 5');
    });

    await act(async () => {
      findByTestId(root, 'transposer-save-as-button').props.onPress();
      await Promise.resolve();
    });

    expect(findAllText(root, 'Save As New Tab').length).toBeGreaterThan(0);

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

  it('starts a blank draft from a loaded saved tab and shows Save instead of Re-save', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    asyncStorageValues.set(
      SAVED_TAB_LIBRARY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tabs: [
          {
            id: 'loaded',
            title: 'Loaded tab',
            inputText: '4 -4',
            createdAt: '2026-03-17T00:00:00.000Z',
            updatedAt: '2026-03-17T00:00:00.000Z',
          },
        ],
      }),
    );

    const renderer = await renderApp();
    const root = renderer.root;

    act(() => {
      findPressableByText(root, 'Library').props.onPress();
    });

    await act(async () => {
      findByTestId(root, 'saved-tab-load:loaded').props.onPress();
      await Promise.resolve();
    });

    act(() => {
      findByTestId(root, 'transposer-new-button').props.onPress();
    });

    expect(findTextInput(root).props.value).toBe('');
    expect(findAllText(root, 'Save').length).toBeGreaterThan(0);
  });

  it('prompts before starting a new draft when there are unsaved changes and can discard them', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    act(() => {
      findTextInput(root).props.onChangeText('4 -4');
    });

    act(() => {
      findByTestId(root, 'transposer-new-button').props.onPress();
    });

    expect(findAllText(root, 'Unsaved changes').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Cancel').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Discard and New').length).toBeGreaterThan(0);
    expect(findAllText(root, 'Save Then New').length).toBeGreaterThan(0);

    act(() => {
      findPressableByText(root, 'Cancel').props.onPress();
    });

    expect(findTextInput(root).props.value).toBe('4 -4');

    act(() => {
      findByTestId(root, 'transposer-new-button').props.onPress();
    });

    act(() => {
      findByTestId(root, 'discard-and-new-button').props.onPress();
    });

    expect(findTextInput(root).props.value).toBe('');
  });

  it('can save the current work and then start a new blank draft', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    act(() => {
      findTextInput(root).props.onChangeText('6 -6');
    });

    act(() => {
      findByTestId(root, 'transposer-new-button').props.onPress();
    });

    await act(async () => {
      findByTestId(root, 'save-then-new-button').props.onPress();
      await Promise.resolve();
    });

    expect(findAllText(root, 'Save Then New').length).toBeGreaterThan(0);

    await act(async () => {
      findByTestId(root, 'save-tab-title-input').props.onChangeText('New draft source');
      await Promise.resolve();
    });

    await act(async () => {
      await findByTestId(root, 'save-tab-confirm-button').props.onPress();
    });

    expect(findTextInput(root).props.value).toBe('');
    expect(findAllText(root, 'Save').length).toBeGreaterThan(0);

    const storedLibrary = parseSavedTabLibrary(asyncStorageValues.get(SAVED_TAB_LIBRARY_STORAGE_KEY) ?? null);
    expect(storedLibrary.tabs).toHaveLength(1);
    expect(storedLibrary.tabs[0]?.title).toBe('New draft source');
    expect(storedLibrary.tabs[0]?.inputText).toBe('6 -6');
  });

  it('prompts before loading over unsaved changes and can save then load', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    asyncStorageValues.set(
      SAVED_TAB_LIBRARY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        tabs: [
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
        ],
      }),
    );

    const renderer = await renderApp();
    const root = renderer.root;

    act(() => {
      findTextInput(root).props.onChangeText('6 -6');
    });

    act(() => {
      findPressableByText(root, 'Library').props.onPress();
    });

    await act(async () => {
      findByTestId(root, 'saved-tab-load:first').props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(findVisibleModal(root)).not.toBeNull();
    expect(findAllText(root, 'Unsaved changes').length).toBeGreaterThan(0);

    await act(async () => {
      findPressableByText(root, 'Save Then Load').props.onPress();
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

  it('keeps the editor text when deleting the active saved tab', async () => {
    stubWebInputEnvironment({ coarsePointerMatches: false, maxTouchPoints: 0 });

    const renderer = await renderApp();
    const root = renderer.root;

    act(() => {
      findTextInput(root).props.onChangeText('4 -4 5');
    });

    await act(async () => {
      findPressableByText(root, 'Save').props.onPress();
      await Promise.resolve();
    });

    await act(async () => {
      findByTestId(root, 'save-tab-title-input').props.onChangeText('Delete me');
      await findByTestId(root, 'save-tab-confirm-button').props.onPress();
    });

    act(() => {
      findPressableByText(root, 'Library').props.onPress();
    });

    await act(async () => {
      findPressableByText(root, 'Delete').props.onPress();
      await Promise.resolve();
    });

    const backButton = findPressableByText(root, '←');

    act(() => {
      backButton.props.onPress();
    });

    expect(findTextInput(root).props.value).toBe('4 -4 5');
    expect(findAllText(root, 'Save').length).toBeGreaterThan(0);
    expect(parseSavedTabLibrary(asyncStorageValues.get(SAVED_TAB_LIBRARY_STORAGE_KEY) ?? null).tabs).toHaveLength(0);
  });
});
