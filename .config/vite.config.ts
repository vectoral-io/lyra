import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, '../src/index.ts'),
      name: 'Lyra',
      fileName: 'index',
      formats: ['es'],
    },
    outDir: resolve(__dirname, '../dist'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      output: {
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: ({ name }) => {
          // Preserve directory structure
          if (name === 'index') return 'index.js';
          return '[name].js';
        },
      },
    },
    sourcemap: true,
  },
});

