import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';

type ClipboardNavigator = Navigator & {
  clipboard?: {
    readText?: () => Promise<string>;
  };
};

export async function readClipboardText(): Promise<string> {
  if (Platform.OS === 'web') {
    const clipboard = (globalThis.navigator as ClipboardNavigator | undefined)?.clipboard;

    if (!clipboard?.readText) {
      throw new Error('Clipboard access is unavailable in this browser.');
    }

    return clipboard.readText();
  }

  return Clipboard.getStringAsync();
}
