import { registerHooks } from 'node:module'

// Source modules use bundler-style relative imports. Resolve them for Node's
// native TypeScript stripping without adding test exports to the package.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.includes('/lsp/src/') && /^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})
