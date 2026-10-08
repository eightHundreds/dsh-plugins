import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { dshCssAssetBridge } from '../../scripts/build/dsh-css-asset-bridge.mjs'

const require = createRequire(import.meta.url)
const monacoVs = resolve(dirname(require.resolve('monaco-editor/editor/editor.api.js')), '..')
const externals = ['react', 'react/jsx-runtime', 'react-dom']

const DECORATOR_SYNTAX = /^\s*@[A-Za-z_$][\w$]*/m

/** Lower standard/TypeScript decorators for Node.js runtime compatibility. */
function decoratorLowering() {
  return {
    name: 'dsh-decorator-lowering',
    transform(code, id) {
      const file = id.split('?', 1)[0] ?? id
      if (!/\.[cm]?tsx?$/.test(file) || !DECORATOR_SYNTAX.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}

/** Collect Monaco styles into the existing plugin-owned lifecycle effect. */
function clientEnvelope() {
  const styles = new Map()
  return {
    name: 'dsh-monaco-client',

    resolveId(source, importer) {
      if (!source.endsWith('.css') || source.endsWith('.module.css')) return null
      const path = source.startsWith('monaco-editor/')
        ? resolve(monacoVs, source.slice('monaco-editor/'.length))
        : resolve(dirname(importer), source)
      return '\0monaco-style:' + path + '.mjs'
    },
    load(id) {
      if (!id.startsWith('\0monaco-style:')) return null
      const path = id.slice('\0monaco-style:'.length, -4)
      this.addWatchFile(path)
      let css = readFileSync(path, 'utf8')
      css = css.replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (match, quote, url) => {
        if (url.startsWith('data:') || url.startsWith('#')) return match
        const font = resolve(dirname(path), url.split('?')[0])
        this.addWatchFile(font)
        return 'url("data:font/ttf;base64,' + readFileSync(font).toString('base64') + '")'
      })
      styles.set(path, css)
      return 'export {};'
    },
    renderChunk(code, chunk) {
      if (!chunk.isEntry) throw new Error('DSH client must be a single bundle')
      const css = [...styles.values()].join('\n')
      return { code: 'const __EDITOR_CSS__=' + JSON.stringify(css) + ';' + code, map: null }
    },
  }
}

export const host = {
  entry: { index: 'src/index.ts', assets: 'src/assets.ts', 'lsp-query': 'src/lsp-query.ts', 'lsp-remote': 'src/lsp-remote.ts', 'lsp-host': 'src/lsp-host.ts' }, outDir: 'lib',
  format: 'esm', platform: 'node', target: 'es2024', fixedExtension: false,
  clean: false, dts: true, deps: { neverBundle: [/^@deepseek-ai\//] },
  plugins: [decoratorLowering()],
}
export const worker = {
  entry: { 'editor.worker': require.resolve('monaco-editor/editor/editor.worker.js') },
  outDir: 'lib/assets', format: 'iife', platform: 'browser', target: 'chrome120',
  fixedExtension: false, clean: false, dts: false, minify: true,
  deps: { alwaysBundle: [/./], onlyBundle: false }, outputOptions: { codeSplitting: false, entryFileNames: '[name].js' },
}
export function client() {
  const revision = createHash('sha256').update(readFileSync('lib/assets/editor.worker.js')).digest('hex').slice(0, 16)
  return {
    entry: { client: 'src/client/index.tsx' }, outDir: 'lib',
    format: 'cjs', platform: 'browser', target: 'chrome120', fixedExtension: false,
    clean: false, dts: true, minify: true,
    deps: { neverBundle: externals, alwaysBundle: [/^monaco-editor/], onlyBundle: false },
    define: { __ASSET_REVISION__: JSON.stringify(revision), 'process.env.NODE_ENV': JSON.stringify('production') },
    outputOptions: {
      codeSplitting: false,
      entryFileNames: '[name].js',
      banner: 'window.__ModuleLoader__.load({id:"@dshx/vscode-editor",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
      footer: 'const __DSH_CSS_MODULES__ = "__DSH_CSS_MODULES__";return module.exports;}});',
    },
    css: {
      inject: false,
      modules: {
        generateScopedName: 'vse_[local]_[hash]',
        localsConvention: 'camelCaseOnly',
      },
    },
    plugins: [clientEnvelope(), dshCssAssetBridge()],
  }
}
