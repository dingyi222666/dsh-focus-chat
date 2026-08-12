import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The plugin builds against the npm rc.1 dependency line: every @deepseek-ai
// import resolves from the installed packages. The runtime's /client entry is
// a browser-shell bundle, so tests consume it through the loader/runtime shim.
const shim = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: '@deepseek-ai/dsh-client-runtime/client', replacement: shim('tests/platform/runtime-shim.ts') },
    ],
  },
  ssr: {
    // Inline the @deepseek-ai client packages so their internal runtime
    // imports go through the alias above (externalized deps bypass it).
    noExternal: [/@deepseek-ai\//],
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
  },
})
