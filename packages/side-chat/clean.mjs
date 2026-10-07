import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('.', import.meta.url))
const output = resolve(root, 'lib')
if (output !== resolve(root, './lib')) throw new Error('Unexpected generated output path')
await rm(output, { recursive: true, force: true })
