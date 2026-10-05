import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load, dump } from 'js-yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [repository = process.env.GITHUB_REPOSITORY, tag = process.env.GITHUB_REF_NAME] = process.argv.slice(2)
assert(repository && /^[\w.-]+\/[\w.-]+$/.test(repository), 'Usage: pnpm release:pack <owner/repo> <release-tag>')
assert(tag && tag !== '.' && tag !== '..' && !/[\s/\\]/.test(tag), 'Release tag must be a single non-empty path segment')
const output = resolve(root, 'artifacts/release', tag)
await mkdir(output, { recursive: true })
const packages = []
for (const entry of await readdir(resolve(root, 'packages'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const pkg = JSON.parse(await readFile(resolve(root, 'packages', entry.name, 'package.json'), 'utf8'))
  if (pkg.private) continue
  const filename = pkg.name.replace(/^@/, '').replaceAll('/', '-') + '-' + pkg.version + '.tgz'
  packages.push({ name: pkg.name, filename, url: 'https://github.com/' + repository + '/releases/download/' + encodeURIComponent(tag) + '/' + filename })
}
assert(packages.length > 0)
const byName = new Map(packages.map((pkg) => [pkg.name, pkg]))
assert.equal(new Set(packages.map((pkg) => pkg.filename)).size, packages.length, 'colliding asset filenames')
async function embed(pkg, target, ancestors = []) {
  assert(!ancestors.includes(pkg.name), 'Cyclic internal runtime dependency: ' + pkg.name)
  await mkdir(target, { recursive: true })
  execFileSync('tar', ['-xzf', resolve(root, 'artifacts', pkg.filename), '-C', target, '--strip-components=1'])
  const manifestPath = resolve(target, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const bundled = new Set(Array.isArray(manifest.bundledDependencies) ? manifest.bundledDependencies : [])
  for (const kind of ['dependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[kind] ?? {})) {
      if (!byName.has(name)) continue
      const sibling = byName.get(name)
      await embed(sibling, resolve(target, 'node_modules', name), [...ancestors, pkg.name])
      bundled.add(name)
    }
  }
  if (bundled.size) {
    manifest.bundledDependencies = [...bundled]
    const patchPath = resolve(target, manifest.dsh.bundle.patch)
    const patch = load(await readFile(patchPath, 'utf8'))
    const visit = (entry) => {
      for (const name of bundled) {
        if (entry.name !== name) continue
        const child = JSON.parse(execFileSync('tar', ['-xOf', resolve(root, 'artifacts', byName.get(name).filename), 'package/package.json'], { encoding: 'utf8' }))
        const main = child.exports?.['.']?.import ?? child.exports?.['.']?.default ?? child.main
        assert(main && !main.includes('..'), 'Embedded plugin needs a package-local host entry: ' + name)
        entry.name = './node_modules/' + name + '/' + (main.startsWith('./') ? main.slice(2) : main)
      }
      if (entry.group && Array.isArray(entry.config)) entry.config.forEach(visit)
    }
    for (const row of patch) row.insert?.forEach(visit)
    await writeFile(patchPath, dump(patch))
  }
  delete manifest.devDependencies
  delete manifest.scripts
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}
const checksums = []
for (const pkg of packages) {
  const scratch = await mkdtemp(resolve(tmpdir(), 'dsh-release-'))
  try {
    await embed(pkg, resolve(scratch, 'package'))
    execFileSync('tar', ['-czf', resolve(output, pkg.filename), '-C', scratch, 'package'])
    const digest = createHash('sha256').update(await readFile(resolve(output, pkg.filename))).digest('hex')
    checksums.push(digest + '  ' + pkg.filename)
    const alias = pkg.name.replace(/^@/, '').replaceAll('/', '-') + '.tgz'
    await copyFile(resolve(output, pkg.filename), resolve(output, alias))
    checksums.push(digest + '  ' + alias)
    pkg.latestUrl = 'https://github.com/' + repository + '/releases/latest/download/' + alias
    console.log(pkg.url)
  } finally {
    assert(scratch.startsWith(resolve(tmpdir(), 'dsh-release-')))
    await rm(scratch, { recursive: true, force: true })
  }
}
await writeFile(resolve(output, 'SHA256SUMS'), checksums.join('\n') + '\n')
await writeFile(resolve(output, 'install.md'), '# DSH 安装\n\n预编译附件，无需 npm 发布或用户编译。组合包与单个插件任选其一，避免重复激活。\n\n' + packages.map((pkg) => '    dsh plugin --profile demo add ' + JSON.stringify(pkg.url) + '\n\n    # 最新正式版本（固定命令）\n    dsh plugin --profile demo add ' + JSON.stringify(pkg.latestUrl)).join('\n\n') + '\n')
console.log('Release assets: ' + output)
