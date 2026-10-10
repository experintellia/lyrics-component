import { defineConfig } from 'vitest/config';

// ponytail: no @vitejs/plugin-react — esbuild handles TSX; we only lose fast refresh in dev.
export default defineConfig(({ mode }) => ({
  ...(mode === 'lib'
    ? {
        build: {
          outDir: 'dist',
          lib: {
            entry: { index: 'src/index.ts', lrc: 'src/lrc.ts', styles: 'src/styles.ts' },
            formats: ['es'],
            cssFileName: 'lyrics',
          },
          rollupOptions: { external: ['react', 'react/jsx-runtime'] },
          minify: false,
        },
      }
    : {
        root: 'demo',
        base: './',
        build: { outDir: '../demo-dist', emptyOutDir: true },
      }),
  test: {
    root: '.',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'demo/**/*.test.{ts,tsx}'],
  },
}));
