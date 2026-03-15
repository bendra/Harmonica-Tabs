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

function findVisibleModal(root: any) {
  return root.findAll((node: any) => node.type === 'Modal')[0] ?? null;
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

  it('defaults touch-first web to the tab pad and exposes the keyboard setting in properties', () => {
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
    expect(findAllText(root, '◉ Custom Tab Pad').length).toBeGreaterThan(0);
    expect(findAllText(root, '○ Native Keyboard').length).toBeGreaterThan(0);
  });

  it('lets touch-first web switch the transposer back to the native keyboard from properties', () => {
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

    const nativeKeyboardButton = findPressableByText(root, '○ Native Keyboard');

    act(() => {
      nativeKeyboardButton.props.onPress();
    });

    expect(findAllText(root, '◉ Native Keyboard').length).toBeGreaterThan(0);
    expect(findAllText(root, '○ Custom Tab Pad').length).toBeGreaterThan(0);

    const backButton = findPressableByText(root, '←');

    act(() => {
      backButton.props.onPress();
    });

    expect(
      findAllText(
        root,
        'Custom tab pad is active. Use Paste in the pad for clipboard text, or switch to Native Keyboard in Settings for the browser edit menu.',
      ).length,
    ).toBe(0);
    expect(findAllText(root, 'Paste')).toHaveLength(0);
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
