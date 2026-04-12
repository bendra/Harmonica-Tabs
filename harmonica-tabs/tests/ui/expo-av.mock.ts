import { vi } from 'vitest';

export const Audio = {
  requestPermissionsAsync: vi.fn().mockResolvedValue({ granted: false }),
};
