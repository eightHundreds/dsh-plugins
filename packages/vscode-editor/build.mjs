import { build } from 'tsdown'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { host, worker, client } from './tsdown.config.mjs'

// Sequential builds keep the worker revision available before compiling the client.
const watch = process.argv.includes('--watch')
await rm(fileURLToPath(new URL('./lib', import.meta.url)), { recursive: true, force: true })
await build({ ...host, config: false })
await build({ ...worker, config: false })
await build({ ...client(), config: false })
if (watch) {
  await build({ ...host, config: false, watch: true })
  await build({ ...client(), config: false, watch: true })
}
