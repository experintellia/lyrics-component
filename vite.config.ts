import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

// Demo footer only: never baked into dist/, or every commit would make dist/ stale.
const git = (f: string) => {
  try {
    return execSync(`git log -1 --format=${f}`, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

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
        define: { __COMMIT__: JSON.stringify({ hash: git('%H'), subject: git('%s') }) },
        build: { outDir: '../demo-dist', emptyOutDir: true },
      }),
  test: {
    root: '.',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'demo/**/*.test.{ts,tsx}'],
  },
}));
