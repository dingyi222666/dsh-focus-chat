import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import ts from 'typescript'

// The plugin's runtime dependencies come from the npm registry at the
// 0.1.2-alpha.2 line (see package.json). The /client entries those packages
// ship are window.__ModuleLoader__ browser closures, and the dsh test
// runtime is built against the source tree, so the TEST graph resolves the
// @deepseek-ai client surface from the dsh mainline source checkout
// (test-dingyi222666, kept on the 0.1.2-alpha.2 release) instead — the same
// contract the in-repo tests use. Everything else resolves from the
// installed npm packages.
const MAINLINE = '/Users/dingyi/projects/dsh/test-dingyi222666'
const local = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

/** Escape a literal string for use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The mainline tsconfig.base.json (JSONC) parsed into its path map. */
function mainlinePaths(): Record<string, string[]> {
  const config = ts.readConfigFile(`${MAINLINE}/tsconfig.base.json`, ts.sys.readFile)
  if (config.error !== undefined) {
    throw new Error(`cannot parse ${MAINLINE}/tsconfig.base.json: ${JSON.stringify(config.error)}`)
  }
  return config.config.compilerOptions.paths ?? {}
}

/** One alias per @deepseek-ai specifier the mainline maps into its own tree. */
function mainlineAliases(): Array<{ find: RegExp; replacement: string }> {
  const aliases: Array<{ find: RegExp; replacement: string }> = []
  for (const [spec, targets] of Object.entries(mainlinePaths())) {
    if (!spec.startsWith('@deepseek-ai/')) continue
    const target = targets[0]
    if (!(target.startsWith('./packages/') || target.startsWith('./vendor/'))) continue
    if (spec.endsWith('/*')) {
      const prefix = spec.slice(0, -2)
      const replacementDir = `${MAINLINE}/${target.slice(2, -2)}`
      aliases.push({ find: new RegExp(`^${escapeRegExp(prefix)}/(.+)$`), replacement: `${replacementDir}/$1` })
    } else {
      aliases.push({ find: new RegExp(`^${escapeRegExp(spec)}$`), replacement: `${MAINLINE}/${target.slice(2)}` })
    }
  }
  return aliases
}

export default defineConfig({
  resolve: {
    alias: [
      // The dsh source graph (the test runtime, the client packages, their
      // vendor half): every @deepseek-ai specifier the mainline maps resolves
      // to that checkout's sources, so the test graph shares one cordis and
      // one client surface.
      ...mainlineAliases(),
      // The dsh test runtime imports the renderer's src seam by path
      // (@deepseek-ai/dsh-client-ui-renderer/src/...); the mainline's path
      // map does not cover the src/* subpath, so pin it to the same source.
      { find: /^@deepseek-ai\/dsh-client-ui-renderer\/src\/(.+)$/, replacement: `${MAINLINE}/packages/client/ui-renderer/src/$1` },
      // The mainline tree's own node_modules carry a SECOND react copy (and
      // its uSES shim); pin the react family to this package's instances so
      // the test runtime and the rendered components share one React.
      { find: /^react$/, replacement: local('node_modules/react') },
      { find: /^react\/jsx-runtime$/, replacement: local('node_modules/react/jsx-runtime') },
      { find: /^react-dom$/, replacement: local('node_modules/react-dom') },
      { find: /^react-dom\/client$/, replacement: local('node_modules/react-dom/client') },
      { find: /^use-sync-external-store$/, replacement: local('node_modules/use-sync-external-store') },
      { find: /^use-sync-external-store\/shim/, replacement: local('node_modules/use-sync-external-store/shim') },
      // The vendor sources import cosmokit scoped (the mainline map resolves
      // it to its own vendor tree); pin the bare spelling to the same source
      // so the graph never holds two cosmokit instances.
      { find: /^cosmokit$/, replacement: `${MAINLINE}/vendor/cosmokit/src` },
      // Any remaining bare @deepseek-ai/dsh-* import (a package the mainline
      // does not map itself) resolves to this package's installed npm copy.
      { find: /^@deepseek-ai\/(dsh-[a-z0-9-]+)$/, replacement: match => local(`node_modules/@deepseek-ai/${match.slice('@deepseek-ai/'.length)}`) },
    ],
  },
  server: {
    fs: {
      // The mainline sources and the dsh source checkout sit outside this
      // package; let vite serve them.
      allow: ['/Users/dingyi/projects/dsh', '/Users/dingyi/.dsh/source'],
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    server: {
      deps: {
        // Inline the @deepseek-ai packages so their imports go through the
        // aliases above (externalized deps bypass vite resolution and would
        // resolve the react family from the mainline tree's own node_modules
        // — a second React instance).
        noExternal: [/@deepseek-ai\//],
      },
    },
  },
})
