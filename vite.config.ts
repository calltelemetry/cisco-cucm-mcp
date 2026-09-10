import { defineConfig } from 'vite';
import { resolve } from 'path';
import { builtinModules } from 'node:module';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        sse: resolve(__dirname, 'src/sse.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        /^@modelcontextprotocol\//,
        'fast-xml-parser',
        'ssh2',
        'zod',
        ...builtinModules,
        ...builtinModules.map(m => `node:${m}`),
      ],
      output: {
        entryFileNames: '[name].js',
      },
    },
    target: 'node18',
    sourcemap: true,
    outDir: 'build',
  },
});
