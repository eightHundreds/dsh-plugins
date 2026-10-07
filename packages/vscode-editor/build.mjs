import { build, context } from 'esbuild'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
const require = createRequire(import.meta.url)
const monacoVs = resolve(dirname(require.resolve('monaco-editor/editor/editor.api.js')), '..')
import { createHash } from 'node:crypto'

// Only generated worker assets inside this package are removed.
await rm(fileURLToPath(new URL('./lib/assets', import.meta.url)), { recursive: true, force: true })
await mkdir('lib/assets', { recursive: true })
const workers = {
  editor: 'monaco-editor/editor/editor.worker.js',
}
for (const [name, entry] of Object.entries(workers)) {
  await build({ entryPoints: [entry], outfile: 'lib/assets/' + name + '.worker.js', bundle: true, format: 'iife', platform: 'browser', minify: true })
}
const revision = createHash('sha256')
for (const name of Object.keys(workers)) revision.update(await readFile('lib/assets/' + name + '.worker.js'))
const options = {
  entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', bundle: true,
  format: 'cjs', platform: 'browser', minify: true, target: 'chrome120',
  external: ['react', 'react/jsx-runtime', 'react-dom'], loader: { '.ttf': 'dataurl' },
  define: { __ASSET_REVISION__: JSON.stringify(revision.digest('hex').slice(0, 16)) },
  plugins: [{ name: 'dsh-client-envelope', setup(builder) {
    builder.onResolve({ filter: new RegExp('^monaco-editor/.*[.]css$') }, args => ({ path: resolve(monacoVs, args.path.slice('monaco-editor/'.length)) }))
    builder.onEnd(async result => {
      if (result.errors.length) return
      const js = await readFile('lib/client.js', 'utf8')
      const css = await readFile('lib/client.css', 'utf8')
      await writeFile('lib/client.js', 'window.__ModuleLoader__.load({id:"@dsk/vscode-editor",factory:(require)=>{var module={exports:{}};var exports=module.exports;const __EDITOR_CSS__=' + JSON.stringify(css) + ';' + js + ';return module.exports;}});')
    })
  }}],
}
if (process.argv.includes('--watch')) {
  const builder = await context(options)
  await builder.watch()
  console.log('Watching Monaco client sources; run typecheck separately.')
} else await build(options)
