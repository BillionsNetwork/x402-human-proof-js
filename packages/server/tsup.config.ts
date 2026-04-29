import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      server: 'src/server.ts',
      hooks: 'src/hooks.ts',
      verifier: 'src/verifier.ts',
      declare: 'src/declare.ts',
      utils: 'src/utils.ts',
      types: 'src/types.ts',
    },
    format: ['esm'],
    outDir: 'dist/node/esm',
    sourcemap: true,
    clean: true,
    splitting: false,
  },
  {
    entry: {
      index: 'src/index.ts',
      server: 'src/server.ts',
      hooks: 'src/hooks.ts',
      verifier: 'src/verifier.ts',
      declare: 'src/declare.ts',
      utils: 'src/utils.ts',
      types: 'src/types.ts',
    },
    format: ['cjs'],
    outDir: 'dist/node/cjs',
    outExtension() {
      return { js: '.cjs' }
    },
    sourcemap: true,
    clean: false,
    splitting: false,
  },
])
