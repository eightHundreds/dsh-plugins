import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const files = (await readdir(resolve(root, 'artifacts'))).filter((file) => file.endsWith('.tgz'))
assert(files.length > 0, 'No tarballs produced')
for (const file of files) {
  const path = resolve(root, 'artifacts', file)
  const entries = execFileSync('tar', ['-tzf', path], { encoding: 'utf8' }).trim().split('\n')
  const content = (entry) => execFileSync('tar', ['-xOf', path, 'package/' + entry], { encoding: 'utf8' })
  const pkg = JSON.parse(content('package.json'))
  assert(!entries.some((entry) => entry.includes('node_modules/') || entry.includes('/src/')), 'Unexpected source/dependencies in tarball')
  const patch = pkg.dsh.bundle.patch.slice(2)
  assert(entries.includes('package/' + patch), 'Missing patch in tarball')
  assert(Array.isArray(load(content(patch))))
  for (const deps of [pkg.dependencies, pkg.peerDependencies, pkg.devDependencies]) {
    for (const range of Object.values(deps ?? {})) assert(!/^(workspace:|link:|file:)/.test(range), 'Unresolved local dependency in tarball')
  }
  for (const value of Object.values(pkg.exports ?? {})) {
    for (const entry of typeof value === 'string' ? [value] : Object.values(value)) {
      if (!entry.includes('*')) assert(entries.includes('package/' + entry.slice(2)), 'Missing packed export ' + entry)
    }
  }
  console.log('Verified tarball ' + pkg.name + '@' + pkg.version)
}
