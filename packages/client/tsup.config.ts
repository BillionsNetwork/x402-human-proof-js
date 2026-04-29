import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      utils: 'src/utils.ts',
    },
    format: ['esm'],
    platform: 'node',
    outDir: 'dist/node/esm',
    sourcemap: true,
    clean: true,
    splitting: false,
  },
  {
    entry: {
      index: 'src/index.ts',
      utils: 'src/utils.ts',
    },
    format: ['cjs'],
    platform: 'node',
    outDir: 'dist/node/cjs',
    outExtension() {
      return { js: '.cjs' }
    },
    sourcemap: true,
    clean: false,
    splitting: false,
  },
  {
    entry: {
      index: 'src/index.ts',
      utils: 'src/utils.ts',
    },
    format: ['esm'],
    platform: 'browser',
    outDir: 'dist/browser/esm',
    sourcemap: true,
    clean: false,
    splitting: false,
  },
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['iife'],
    globalName: 'HumanProofClient',
    platform: 'browser',
    outDir: 'dist/browser/umd',
    outExtension() {
      return { js: '.global.js' }
    },
    sourcemap: true,
    clean: false,
    splitting: false,
  },
])
