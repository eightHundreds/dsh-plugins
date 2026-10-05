import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const slug = process.argv[2]
if (!slug || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error('Usage: pnpm new:plugin <lowercase-kebab-name>')
  process.exit(1)
}
const target = resolve(root, 'packages', slug)
// mkdir without recursive refuses to overwrite an existing package.
await mkdir(target)
const files = ['package.json', 'tsconfig.json', 'cordis.patch.yml', 'src/index.ts', 'locale/en.json', 'locale/zh.json', 'README.md']
for (const file of files) {
  const source = await readFile(resolve(root, 'packages/hello', file), 'utf8')
  const content = source.replaceAll('@dsk/hello', '@dsk/' + slug)
    .replaceAll('example-hello', slug).replaceAll('Example Hello', slug)
    .replaceAll('Hello 示例', slug)
  await mkdir(dirname(resolve(target, file)), { recursive: true })
  await writeFile(resolve(target, file), content, { flag: 'wx' })
}
console.log('Created packages/' + slug + '. Run pnpm install, then pnpm check.')
console.log('The new package is standalone; add it to the composition bundle only if desired.')
