import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    watch: false,
    exclude: [
      '**/node_modules/**',
    ],
    benchmark: {
      include: [
        '**/*.benchmark.ts',
      ],
    },
    coverage: {
      provider: 'v8',
      include: [
        'src/**/*.ts',
      ],
      exclude: [
        '**/node_modules/**',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.benchmark.ts',
      ],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
      clean: true,
      reportsDirectory: './.config/coverage',
    },
  },
});