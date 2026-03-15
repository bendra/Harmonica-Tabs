import React from 'react';
import { vi } from 'vitest';

export const scrollToSpy = vi.fn();

function createHostComponent(name: string, imperativeHandle?: () => Record<string, unknown>) {
  return React.forwardRef((props: any, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => imperativeHandle?.() ?? {}, []);
    return React.createElement(name, props, props.children);
  });
}

export function resetReactNativeMocks() {
  scrollToSpy.mockClear();
}

export const SafeAreaView = createHostComponent('SafeAreaView');
export const ScrollView = createHostComponent('ScrollView', () => ({ scrollTo: scrollToSpy }));
export const Modal = ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
  visible ? React.createElement('Modal', null, children) : null;
export const Pressable = createHostComponent('Pressable');
export const Text = createHostComponent('Text');
export const TextInput = createHostComponent('TextInput', () => ({ focus: vi.fn(), blur: vi.fn() }));
export const View = createHostComponent('View', () => ({
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(0, 0, 100, 40),
}));
export const Platform = {
  OS: 'web',
};
export const StyleSheet = {
  create: <T,>(styles: T) => styles,
  absoluteFill: {},
};
export const useWindowDimensions = () => ({ width: 400, height: 800, scale: 1, fontScale: 1 });
