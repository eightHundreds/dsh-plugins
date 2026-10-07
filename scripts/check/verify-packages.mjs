import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const packages = []
for (const entry of await readdir(resolve(root, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const dir = resolve(root, 'packages', entry.name)
  const pkg = JSON.parse(await readFile(resolve(dir, 'package.json'), 'utf8'))
  packages.push({ pkg, dir })
}
assert.equal(new Set(packages.map(({ pkg }) => pkg.name)).size, packages.length, 'duplicate package names')
for (const { pkg, dir } of packages) {
  assert(/^@dsk\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(pkg.name), 'package name must use @dsk/<kebab-name>: ' + pkg.name)
  assert.equal(pkg.type, 'module')
  assert(pkg.dsh?.bundle?.patch, pkg.name + ': missing bundle metadata')
  const patch = pkg.dsh.bundle.patch
  assert(patch.startsWith('./') && !patch.includes('..'), 'patch must be package-local')
  assert(pkg.files.includes(patch.slice(2)), pkg.name + ': patch excluded from package')
  const rows = load(await readFile(resolve(dir, patch), 'utf8'))
  assert(Array.isArray(rows) && rows.length > 0, 'patch must be non-empty')
  const ids = new Set()
  for (const operation of rows) {
    if (operation.id && operation.disabled !== undefined) {
      assert(typeof operation.id === 'string' && typeof operation.disabled === 'boolean')
      continue
    }
    assert(Array.isArray(operation.insert) && operation.insert.length > 0)
    for (const row of operation.insert) {
      assert(row.id && row.name && !ids.has(row.id), 'missing or duplicate patch row')
      ids.add(row.id)
      assert(row.name === pkg.name || pkg.dependencies?.[row.name], 'patch references an undeclared dependency')
    }
  }
  for (const kind of ['dependencies', 'peerDependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(pkg[kind] ?? {})) {
      assert(!range.startsWith('link:') && !range.startsWith('file:'), 'local dependency cannot be published: ' + name)
      if (range.startsWith('workspace:')) assert(packages.some(({ pkg }) => pkg.name === name), 'unknown workspace dependency')
    }
  }
  for (const value of Object.values(pkg.exports ?? {})) {
    const path = typeof value === 'string' ? value : value.import ?? value.default
    if (!path || path.includes('*')) continue
    assert((await stat(resolve(dir, path))).isFile(), pkg.name + ': missing export ' + path)
    if (typeof value === 'object' && value.types) assert((await stat(resolve(dir, value.types))).isFile())
  }
  const sourceDir = resolve(dir, 'src')
  async function verifyCssModules(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) {
        await verifyCssModules(path)
        continue
      }
      if (!/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) continue
      const source = await readFile(path, 'utf8')
      const imports = source.matchAll(/(?:from\s*|import\s*)['\"]([^'\"]+\.css)['\"]/g)
      for (const [, specifier] of imports) {
        assert(specifier.endsWith('.module.css') || !specifier.startsWith('.'),
          `${pkg.name}: local component CSS must use CSS Modules (.module.css): ${specifier}`)
      }
    }
  }
  if ((await stat(sourceDir).catch(() => undefined))?.isDirectory()) await verifyCssModules(sourceDir)
  // DSH's client-modules registry reads exports["./client"] as a plain relative
  // path: it accepts a string or an object with a string `default`, and rejects
  // the `import` condition other tooling uses. A rejected entry aborts startup.
  if (pkg.dsh?.client?.platform === 'web') {
    const entry = pkg.exports?.['./client']
    if (typeof entry === 'object' && entry !== null && 'import' in entry && !('default' in entry)) {
      assert.fail(`${pkg.name}: exports["./client"] uses "import" condition without "default", which DSH client-modules rejects`)
    }
    const bundle = typeof entry === 'string'
      ? entry
      : typeof entry === 'object' && entry !== null && typeof entry.default === 'string' ? entry.default : undefined
    assert(bundle, pkg.name + ': exports["./client"] must be a string or an object with a string default')
    assert((await stat(resolve(dir, bundle))).isFile(), pkg.name + ': missing client bundle ' + bundle)
  }
  console.log('Verified ' + pkg.name)
}
