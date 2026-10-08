import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOfficialEntryIds } from './official-entry-ids.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const root = process.env.DSH_PLUGIN_ROOT ?? repoRoot
const harness = process.env.DSH_HARNESS ?? resolve(repoRoot, '../deepseek-harness')

const args = process.argv.slice(2)
const isUi = args.includes('--ui')
const slug = args.find((arg) => !arg.startsWith('--'))

if (!slug || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error('Usage: pnpm new:plugin <lowercase-kebab-name> [--ui]')
  process.exit(1)
}

let officialIds
try {
  officialIds = await loadOfficialEntryIds(harness)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
if (officialIds.has(slug)) {
  console.error(
    `Refusing @dshx/${slug}: "${slug}" is an official DSH entry id. Insert a distinct id and disable the official row separately.`,
  )
  process.exit(1)
}

const target = resolve(root, 'packages', slug)
// mkdir without recursive refuses to overwrite an existing package.
await mkdir(target)

async function writeTargetFile(relPath, content) {
  const fullPath = resolve(target, relPath)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content, { flag: 'wx' })
}

if (!isUi) {
  // Standard Host-only plugin
  const files = ['package.json', 'tsconfig.json', 'tsdown.config.ts', 'cordis.patch.yml', 'src/index.ts', 'locale/en.json', 'locale/zh.json', 'README.md']
  for (const file of files) {
    const source = await readFile(resolve(root, 'packages/hello', file), 'utf8')
    let content = source.replaceAll('@dshx/hello', '@dshx/' + slug)
      .replaceAll('example-hello', slug).replaceAll('Example Hello', slug)
      .replaceAll('Hello 示例', slug)
    if (file === 'package.json') {
      const manifest = JSON.parse(content)
      manifest.scripts = {
        ...manifest.scripts,
        test: 'node --test tests/*.test.mjs',
      }
      content = JSON.stringify(manifest, null, 2) + '\n'
    }
    await writeTargetFile(file, content)
  }

  // Include minimal unit test
  const testContent = `import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../lib/index.js'

test('${slug} plugin lifecycle', async () => {
  const ctx = new Context()
  const fiber = ctx.plugin(plugin)
  await fiber.ready
  assert(fiber.status !== undefined)
  await fiber.dispose()
})
`
  await writeTargetFile('tests/index.test.mjs', testContent)
} else {
  // UI plugin with host entry + web client UI bundle
  const manifest = {
    name: `@dshx/${slug}`,
    version: '0.0.0',
    description: `${slug} plugin with web client UI`,
    type: 'module',
    license: 'UNLICENSED',
    main: './lib/index.js',
    types: './lib/index.d.ts',
    exports: {
      '.': {
        types: './lib/index.d.ts',
        default: './lib/index.js',
      },
      './client': {
        types: './lib/client/index.d.ts',
        default: './lib/client.js',
      },
      './package.json': './package.json',
      './cordis.patch.yml': './cordis.patch.yml',
      './locale/*.json': './locale/*.json',
    },
    files: [
      'lib',
      'cordis.patch.yml',
      'locale',
    ],
    scripts: {
      build: 'tsc -p tsconfig.json && tsdown',
      dev: 'tsdown --watch',
      typecheck: 'tsc -p tsconfig.json --noEmit',
      test: 'node --test tests/*.test.mjs',
      prepack: 'pnpm run build',
    },
    keywords: [
      'dsh-plugin',
      'deepseek-harness',
      'cordis',
    ],
    engines: {
      node: '>=24',
    },
    peerDependencies: {
      '@deepseek-ai/cordis': '^4.0.4',
      react: '>=18 <20',
    },
    devDependencies: {
      '@deepseek-ai/cordis': '4.0.4',
      '@deepseek-ai/dsh-client-locale': '0.2.0-rc.2',
      '@deepseek-ai/dsh-client-ui-primitives': '0.2.0-rc.2',
      '@deepseek-ai/dsh-client-ui-slots': '0.2.0-rc.2',
      '@tsdown/css': '0.23.0',
      '@types/node': '^24.0.0',
      '@types/react': '^18.3.0',
      react: '^18.3.1',
      tsdown: '^0.22.2',
      typescript: '5.9.3',
    },
    dsh: {
      bundle: {
        patch: './cordis.patch.yml',
      },
      client: {
        platform: 'web',
        inject: [
          '@deepseek-ai/dsh-client-ui-slots',
          '@deepseek-ai/dsh-client-locale',
        ],
      },
    },
  }

  const tsconfig = {
    extends: '../../tsconfig.base.json',
    compilerOptions: {
      rootDir: 'src',
      outDir: 'lib',
      jsx: 'react-jsx',
      lib: ['ES2022', 'ESNext.Disposable', 'DOM'],
      allowArbitraryExtensions: true,
    },
    include: ['src/**/*.ts', 'src/**/*.tsx'],
  }

  const tsdownConfig = `import { defineConfig } from 'tsdown'
import { dshCssAssetBridge } from '../../scripts/build/dsh-css-asset-bridge.mjs'

const baseline = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    deps: { neverBundle: ['@deepseek-ai/cordis'] },
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    sourcemap: true,
    deps: { neverBundle: baseline },
    css: {
      inject: false,
      modules: {
        generateScopedName: 'dshx_${slug.replaceAll('-', '_')}_[local]_[hash]',
        localsConvention: 'camelCaseOnly',
      },
    },
    plugins: [dshCssAssetBridge()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({id:"@dshx/${slug}",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
      footer: 'const __DSH_CSS_MODULES__ = "__DSH_CSS_MODULES__";return module.exports;}});',
    },
  },
])
`

  const patchYaml = `- insert:
    - id: ${slug}
      name: '@dshx/${slug}'
`

  const hostIndex = `import type { Context } from '@deepseek-ai/cordis'

export const name = '${slug}'

export function apply(ctx: Context): void {
  ctx.effect(() => {
    console.info('[@dshx/${slug}] host loaded')
    return () => {
      console.info('[@dshx/${slug}] host disposed')
    }
  })
}
`

  const clientIndex = `import type { Context } from '@deepseek-ai/cordis'
import styles from './styles.module.css'

declare const __DSH_CSS_MODULES__: string

export const name = '${slug}'
export const inject = ['slots']

export function apply(ctx: Context): void {
  ctx.effect(() => {
    console.info('[@dshx/${slug}] client loaded', styles.container)
    return () => {
      console.info('[@dshx/${slug}] client disposed')
    }
  })
}
`

  const clientCss = `.container {
  display: flex;
  flex-direction: column;
  padding: 8px;
}
`

  const cssDts = `declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
`

  const localeEn = {
    title: slug,
  }

  const localeZh = {
    title: slug,
  }

  const readme = `# @dshx/${slug}

UI plugin for DeepSeek Harness (DSH).
`

  const testContent = `import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../lib/index.js'

test('${slug} host plugin lifecycle', async () => {
  const ctx = new Context()
  const fiber = ctx.plugin(plugin)
  await fiber.ready
  assert(fiber.status !== undefined)
  await fiber.dispose()
})
`

  await writeTargetFile('package.json', JSON.stringify(manifest, null, 2) + '\n')
  await writeTargetFile('tsconfig.json', JSON.stringify(tsconfig, null, 2) + '\n')
  await writeTargetFile('tsdown.config.ts', tsdownConfig)
  await writeTargetFile('cordis.patch.yml', patchYaml)
  await writeTargetFile('src/index.ts', hostIndex)
  await writeTargetFile('src/client/index.tsx', clientIndex)
  await writeTargetFile('src/client/styles.module.css', clientCss)
  await writeTargetFile('src/client/css-modules.d.ts', cssDts)
  await writeTargetFile('locale/en.json', JSON.stringify(localeEn, null, 2) + '\n')
  await writeTargetFile('locale/zh.json', JSON.stringify(localeZh, null, 2) + '\n')
  await writeTargetFile('README.md', readme)
  await writeTargetFile('tests/index.test.mjs', testContent)
}

console.log('Created packages/' + slug + (isUi ? ' (UI plugin)' : ' (host plugin)') + '. Run pnpm install, then pnpm check.')
console.log('The new package is standalone; add it to the composition bundle only if desired.')
