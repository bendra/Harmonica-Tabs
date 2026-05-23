declare const process:
  | {
      env?: {
        EXPO_PUBLIC_BUILD_ID?: string;
      };
    }
  | undefined;

export const BUILD_ID =
  typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_BUILD_ID
    ? process.env.EXPO_PUBLIC_BUILD_ID
    : 'dev-unset';
