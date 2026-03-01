import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'index',
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
    },
    target: 'node18',
    sourcemap: true,
    outDir: 'build',
  },
});
