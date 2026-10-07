import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { load } from 'js-yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [repository = process.env.GITHUB_REPOSITORY, tag = process.env.GITHUB_REF_NAME] = process.argv.slice(2)
assert(repository && tag, 'Usage: pnpm test:release <owner/repo> <release-tag> (run release:pack first)')
const assets = resolve(root, 'artifacts/release', tag)
const fixture = await mkdtemp(resolve(tmpdir(), 'dsh-release-install-'))
const served = new Map()
const fetched = new Set()
const server = createServer((req, res) => {
  const body = served.get(req.url)
  if (!body) { res.writeHead(404); res.end(); return }
  fetched.add(req.url)
  res.writeHead(200, { 'content-type': 'application/octet-stream' })
  res.end(body)
})
try {
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const localBase = 'http://127.0.0.1:' + server.address().port + '/'
  const files = (await readdir(assets)).filter((file) => file.endsWith('.tgz'))
  const sums = await readFile(resolve(assets, 'SHA256SUMS'), 'utf8')
  const manifests = []
  for (const filename of files) {
    const data = await readFile(resolve(assets, filename))
    assert(sums.includes(createHash('sha256').update(data).digest('hex') + '  ' + filename))
    const unpack = resolve(fixture, filename)
    await mkdir(unpack)
    execFileSync('tar', ['-xzf', resolve(assets, filename), '-C', unpack])
    const manifestPath = resolve(unpack, 'package/package.json')
    const pkg = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert(!pkg.scripts && !pkg.devDependencies, 'release must not require author build tools')
    const alias = pkg.name.replace(/^@/, '').replaceAll('/', '-') + '.tgz'
    const versioned = pkg.name.replace(/^@/, '').replaceAll('/', '-') + '-' + pkg.version + '.tgz'
    assert.deepEqual(await readFile(resolve(assets, alias)), await readFile(resolve(assets, versioned)), 'latest alias must match versioned attachment')
    if (filename !== alias) continue
    manifests.push({ pkg, filename })
    served.set('/' + filename, data)
  }
  const names = new Set(manifests.map(({ pkg }) => pkg.name))
  for (const { pkg, filename } of manifests) {
    const original = JSON.parse(execFileSync('tar', ['-xOf', resolve(assets, filename), 'package/package.json'], { encoding: 'utf8' }))
    for (const kind of ['dependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(original[kind] ?? {})) {
        if (names.has(name)) {
          assert(original.bundledDependencies?.includes(name), 'internal dependency must be embedded')
          assert(!/^(workspace:|file:|link:|https?:)/.test(range), 'internal range must be regular semver')
        }
      }
    }
  }
  const profile = resolve(fixture, 'profile')
  await mkdir(profile)
  await writeFile(resolve(profile, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  await writeFile(resolve(profile, 'pnpm-workspace.yaml'), 'autoInstallPeers: false\nallowBuilds: {}\n')
  // Current plugins have no runtime Cordis imports; real DSH provides its framework peer.
  // Install the composition package alone before any standalone package can mask a missing dependency.
  const ordered = [...manifests].sort((a, b) => Object.keys(b.pkg.dependencies ?? {}).length - Object.keys(a.pkg.dependencies ?? {}).length)
  for (const { filename } of ordered) {
    await new Promise((done, reject) => {
      const child = spawn('pnpm', ['add', localBase + filename, '--ignore-scripts'], { cwd: profile, stdio: 'inherit' })
      child.on('error', reject)
      child.on('exit', (code) => code === 0 ? done() : reject(new Error('isolated pnpm install failed: ' + code)))
    })
  }
  for (const { pkg, filename } of manifests) {
    assert(fetched.has('/' + filename), 'package must be fetched over HTTP')
    const installed = JSON.parse(await readFile(resolve(profile, 'node_modules', pkg.name, 'package.json'), 'utf8'))
    assert.equal(installed.name, pkg.name)
    const installedDir = resolve(profile, 'node_modules', pkg.name)
    const patch = load(await readFile(resolve(installedDir, installed.dsh.bundle.patch), 'utf8'))
    for (const operation of patch) {
      for (const entry of operation.insert ?? []) {
        if (entry.name.startsWith('./')) {
          const plugin = await import(pathToFileURL(resolve(installedDir, entry.name)).href)
          assert.equal(typeof plugin.apply, 'function', 'embedded patch entry must load')
        }
      }
    }
  }
  // Prove the bundle resolves its sibling through its own node_modules, without a registry package.
  for (const { pkg } of manifests) {
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (!names.has(name)) continue
      const nested = JSON.parse(await readFile(resolve(profile, 'node_modules', pkg.name, 'node_modules', name, 'package.json'), 'utf8'))
      assert.equal(nested.name, name)
    }
  }
  console.log('Release checksums, embedded sibling packages and isolated HTTP installation verified.')
} finally {
  await new Promise((done) => server.close(done))
  assert(fixture.startsWith(resolve(tmpdir(), 'dsh-release-install-')))
  await rm(fixture, { recursive: true, force: true })
}
