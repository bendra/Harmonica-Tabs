import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';
import { resetReactNativeMocks, scrollToSpy } from './react-native.mock';

const readClipboardTextMock = vi.fn();

vi.mock('../../src/logic/transposer-clipboard', () => ({
  readClipboardText: readClipboardTextMock,
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

describe('App navigation', () => {
  beforeEach(() => {
    resetReactNativeMocks();
    readClipboardTextMock.mockReset();
    readClipboardTextMock.mockResolvedValue('');
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

    expect(() =>
      root.find((node: any) => node.type === 'Text' && flattenTextChildren(node.children) === 'Tab Transposer'),
    ).not.toThrow();
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

    expect(() =>
      root.find((node: any) => node.type === 'Text' && flattenTextChildren(node.children) === 'Tab Transposer'),
    ).not.toThrow();
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
});
