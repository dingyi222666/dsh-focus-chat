import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The plugin builds against the dsh v0.1.2-alpha.1 dependency line: every
// @deepseek-ai import resolves from the installed packages (locally, through
// junctions into the dsh source checkout — see the README Development section).
const local = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      // The junctioned dynamic packages ship their /client entries as
      // window.__ModuleLoader__ browser closures; tests need the real module
      // graph, so point the /client subpaths at their TypeScript sources.
      { find: /^@deepseek-ai\/dsh-client-ui-renderer\/client$/, replacement: local('node_modules/@deepseek-ai/dsh-client-ui-renderer/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-ui-session\/client$/, replacement: local('node_modules/@deepseek-ai/dsh-client-ui-session/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-ui-conversation\/client$/, replacement: local('node_modules/@deepseek-ai/dsh-client-ui-conversation/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-ui-chat\/client$/, replacement: local('node_modules/@deepseek-ai/dsh-client-ui-chat/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-locale\/client$/, replacement: local('node_modules/@deepseek-ai/dsh-client-locale/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-client-test-runtime$/, replacement: local('node_modules/@deepseek-ai/dsh-client-test-runtime/src/index.ts') },
      // The junctioned source tree resolves @deepseek-ai/cordis (and its
      // cosmokit fork) from the dsh tree's own vendor; pin both to this
      // package's instances so the test graph shares one cordis.
      { find: /^@deepseek-ai\/cordis$/, replacement: local('node_modules/@deepseek-ai/cordis') },
      { find: /^@deepseek-ai\/cosmokit$/, replacement: local('node_modules/@deepseek-ai/cosmokit') },
      { find: /^cosmokit$/, replacement: local('node_modules/@deepseek-ai/cosmokit') },
      { find: /^@deepseek-ai\/dsh-client-connection\/client$/, replacement: local('node_modules/@deepseek-ai/dsh-client-connection/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-api-session-controller\/client$/, replacement: local('node_modules/@deepseek-ai/dsh-api-session-controller/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-api-workspace-controller\/client$/, replacement: local('node_modules/@deepseek-ai/dsh-api-workspace-controller/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-api-remotes\/client$/, replacement: local('node_modules/@deepseek-ai/dsh-api-remotes/src/client/index.ts') },
      { find: /^@deepseek-ai\/dsh-api-gateway\/client$/, replacement: local('node_modules/@deepseek-ai/dsh-api-gateway/src/client/index.ts') },
      // Any remaining bare @deepseek-ai/dsh-* import inside the junctioned
      // source tree (the test runtime, the host packages) resolves to this
      // package's own node_modules instead of the dsh tree's workspace store.
      { find: /^@deepseek-ai\/dsh-util-crypto$/, replacement: local('node_modules/@deepseek-ai/dsh-util-crypto/src/index.ts') },
      { find: /^@deepseek-ai\/(dsh-[a-z0-9-]+)$/, replacement: match => local(`node_modules/@deepseek-ai/${match.slice('@deepseek-ai/'.length)}`) },
      // The junctioned packages sit inside the dsh source tree, whose own
      // node_modules carry a SECOND react copy; pin the react family (and its
      // uSES shim) to this package's instances so the test runtime and the
      // rendered components share one React.
      { find: /^react$/, replacement: local('node_modules/react') },
      { find: /^react\/jsx-runtime$/, replacement: local('node_modules/react/jsx-runtime') },
      { find: /^react-dom$/, replacement: local('node_modules/react-dom') },
      { find: /^react-dom\/client$/, replacement: local('node_modules/react-dom/client') },
      { find: /^use-sync-external-store$/, replacement: local('node_modules/use-sync-external-store') },
      { find: /^use-sync-external-store\/shim/, replacement: local('node_modules/use-sync-external-store/shim') },
    ],
  },
  server: {
    fs: {
      // The junctioned @deepseek-ai packages resolve into the dsh source
      // trees (the checkout and the staging clone); let vite serve them.
      allow: ['/Users/dingyi/projects/dsh', '/Users/dingyi/.dsh/source'],
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    server: {
      deps: {
        // Inline the @deepseek-ai client packages so their imports go through
        // the aliases above (externalized deps bypass vite resolution and
        // would resolve the react family from the dsh source tree's own
        // node_modules — a second React instance).
        noExternal: [/@deepseek-ai\//],
      },
    },
  },
})
