#!/usr/bin/env node
// Offline checks only: never import plugin code or evaluate !!js expressions.
import { readFile, readdir, realpath, lstat, stat } from 'node:fs/promises'
import { resolve, dirname, join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { load, JSON_SCHEMA, Type } from 'js-yaml'

const schema = JSON_SCHEMA.extend(new Type('tag:yaml.org,2002:js', {
  kind: 'scalar', construct: value => ({ __jsExpr: value }),
}))
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
async function patches(path, optional = false) {
  let text
  try { text = await readFile(path, 'utf8') } catch (error) {
    if (optional && error.code === 'ENOENT') return []
    throw error
  }
  const rows = load(text, { schema }) ?? []
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error(`${path}: expected a patch list`)
  }
  return rows
}
const targetFile = entry => typeof entry === 'string' ? entry : entry?.import ?? entry?.default

export async function verifyDesktopInstall({ root = repository, profileDir = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles/desktop'), target } = {}) {
  const checks = []
  const check = (ok, code, message, plugin) => checks.push({ ok: Boolean(ok), code, message, plugin })
  try {
    const profile = await json(join(profileDir, 'package.json'))
    const overrides = await patches(join(profileDir, 'cordis.patch.yml'), true)
    const available = (await readdir(join(root, 'packages'), { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name)
    const slug = target?.replace(/^@dshx\//, '')
    const selected = slug ? [slug] : [...new Set([
      ...Object.keys(profile.dependencies ?? {}),
      ...(Array.isArray(profile.dsh?.profile?.bundles) ? profile.dsh.profile.bundles : []),
    ])].filter(name => name.startsWith('@dshx/')).map(name => name.slice(6))
    check(selected.length > 0, 'selection', selected.length ? `Checking ${selected.length} plugin(s)` : 'No @dshx plugins selected or declared')
    for (const name of selected) {
      if (!available.includes(name)) {
        check(false, 'package', `Unknown repository plugin: ${name}`, name)
        continue
      }
      const pkgDir = join(root, 'packages', name)
      const pkg = await json(join(pkgDir, 'package.json'))
      const fullName = `@dshx/${name}`
      check(pkg.name === fullName, 'identity', `Package identity: ${fullName}`, name)
      const spec = profile.dependencies?.[fullName]
      check(typeof spec === 'string' && spec.startsWith('link:') && isAbsolute(spec.slice(5)) && resolve(spec.slice(5)) === resolve(pkgDir), 'dependency', `Dependency must be link:${pkgDir}`, name)
      try {
        const installed = join(profileDir, 'node_modules', fullName)
        check((await lstat(installed)).isSymbolicLink() && await realpath(installed) === await realpath(pkgDir), 'installed-link', `Installed node_modules link resolves to ${pkgDir}`, name)
      } catch (error) { check(false, 'installed-link', `Installed link missing or unreadable: ${error.message}`, name) }
      check(Array.isArray(profile.dsh?.profile?.bundles) && profile.dsh.profile.bundles.includes(fullName), 'bundle', `Selected in dsh.profile.bundles: ${fullName}`, name)
      // Repeated profile overrides replace fields; the last config is authoritative.
      const hmr = Object.assign({}, ...overrides.filter(row => row.id === 'hmr' && !row.insert))
      const roots = hmr.config?.root
      check(hmr.disabled !== true && Array.isArray(roots) && roots.some(path => typeof path === 'string' && isAbsolute(path) && resolve(path) === resolve(pkgDir, 'lib')), 'hmr', `Enabled HMR profile configuration includes ${join(pkgDir, 'lib')}`, name)
      const outputs = [['host-output', targetFile(pkg.exports?.['.']) ?? pkg.main]]
      if (pkg.dsh?.client?.platform === 'web') {
        const entry = pkg.exports?.['./client']
        outputs.push(['client-output', typeof entry === 'string' ? entry : entry?.default])
      }
      for (const [code, file] of outputs) {
        let exists = false
        if (typeof file === 'string') {
          try { exists = (await stat(resolve(pkgDir, file))).isFile() } catch {}
        }
        check(exists, code, `${code}: ${file ?? 'no runtime export declared'} (build ${fullName} if missing)`, name)
      }
      // Syntax check host output to prevent runtime syntax errors (e.g. untranspiled decorators)
      const hostFile = targetFile(pkg.exports?.['.']) ?? pkg.main
      if (typeof hostFile === 'string') {
        const hostPath = resolve(pkgDir, hostFile)
        try {
          if ((await stat(hostPath)).isFile()) {
            const result = spawnSync(process.execPath, ['--check', hostPath], { stdio: 'pipe' })
            check(result.status === 0, 'host-syntax', result.status === 0 ? 'Host output syntax is valid' : `Host output syntax error: ${result.stderr?.toString().trim() || 'syntax check failed'}`, name)
          }
        } catch {}
      }
      const declared = pkg.dsh?.bundle?.patch
      const files = typeof declared === 'string' ? [declared] : declared
      const valid = Array.isArray(files) && files.length > 0 && files.every(file => typeof file === 'string')
      check(valid, 'patch-manifest', 'Bundle declares patch file(s)', name)
      if (!valid) continue
      const local = []
      for (const file of files) local.push(...await patches(resolve(pkgDir, file)))
      check(true, 'patch-files', 'Declared bundle patches are readable in the DSH YAML dialect', name)
      // Check explicit profile reversals of local conflict rules. Full composition
      // (other bundles, nested includes, launcher overlays) requires a runtime probe.
      for (const rule of local.filter(row => row.id && !row.insert && row.disabled === true)) {
        const matching = overrides.filter(row => row.id === rule.id && !row.insert && (!row.name || row.name === rule.name))
        const disabled = matching.reduce((value, row) => Object.hasOwn(row, 'disabled') ? row.disabled : value, true)
        check(disabled === true, 'conflict', `Bundle disables ${rule.id}; profile must not re-enable it`, name)
      }
    }
  } catch (error) { check(false, 'input', error.message) }
  return { ok: checks.length > 0 && checks.every(item => item.ok), checks, runtimeVerified: false }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length > 1 || args[0]?.startsWith('-')) {
    console.error('Usage: node scripts/check/verify-desktop-install.mjs [plugin-name | @dshx/plugin-name]')
    process.exitCode = 1
  } else {
    const result = await verifyDesktopInstall({ target: args[0] })
    for (const item of result.checks) console.log(`[${item.ok ? 'PASS' : 'FAIL'}] ${item.plugin ? `${item.plugin}: ` : ''}${item.message}`)
    console.log(result.ok ? 'Static Desktop installation checks PASSED.' : 'Static Desktop installation checks FAILED.')
    console.log('Runtime activation, Client registration, UI rendering, peer compatibility and HMR delivery are NOT verified. Confirm them in Desktop before reporting the plugin effective.')
    process.exitCode = result.ok ? 0 : 1
  }
}
