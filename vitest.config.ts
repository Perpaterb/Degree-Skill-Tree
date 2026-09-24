import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts, whose root is web/.
export default defineConfig({
  test: { include: ['core/**/*.test.ts', 'scraper/test/**/*.test.ts'] },
});
