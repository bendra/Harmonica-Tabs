import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'react-native': resolve(__dirname, 'tests/ui/react-native.mock.tsx'),
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**', 'build/**', '.expo/**'],
  },
});
