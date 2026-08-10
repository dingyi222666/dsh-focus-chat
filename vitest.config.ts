import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The dsh checkout's SOURCE tree: vitest must load the workspace packages
// from src (vite transpiles tsx and handles css modules), never from their
// built lib/ artifacts (tsc output carries css imports without the assets).
const repo = (rel: string): string => fileURLToPath(new URL(`../test-dingyi222666/${rel}`, import.meta.url))

export default defineConfig({
  resolve: {
    // One React instance: repo-src imports (web-react's use-sync-external-store
    // chain) and this project's react family must dedupe onto the root copy.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'use-sync-external-store'],
    alias: [
      { find: 'cordis', replacement: repo('vendor/cordis/src/index.ts') },
      { find: '@deepseek-ai/dsh-client-runtime/client', replacement: repo('packages/client/runtime/src/client/index.ts') },
      { find: '@deepseek-ai/dsh-client-ui-slots', replacement: repo('packages/client/ui-slots/src/index.ts') },
      { find: '@deepseek-ai/dsh-client-web-react', replacement: repo('packages/client/web-react/src/index.ts') },
      { find: '@deepseek-ai/dsh-client-ui-primitives', replacement: repo('packages/client/ui-primitives/src/index.ts') },
      { find: '@deepseek-ai/dsh-client-test-runtime', replacement: repo('packages/client/test-runtime/src/index.ts') },
      { find: '@deepseek-ai/dsh-client-ui-conversation/client', replacement: repo('packages/client/ui-conversation/src/client/index.ts') },
      { find: '@deepseek-ai/dsh-client-connection/client', replacement: repo('packages/client/connection/src/client/index.ts') },
      { find: '@deepseek-ai/dsh-invariants', replacement: repo('packages/support/invariants/src/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-locale\/src\/(.*)$/, replacement: repo('packages/client/locale/src/$1') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
  },
})
