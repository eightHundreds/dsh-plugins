#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const steps = [
  { name: 'typecheck', cmd: 'pnpm', args: ['run', 'typecheck'] },
  { name: 'test', cmd: 'pnpm', args: ['run', 'test'] },
  { name: 'verify-packages', cmd: 'node', args: ['scripts/check/verify-packages.mjs'] },
  { name: 'check-workflows', cmd: 'node', args: ['scripts/check/check-workflows.mjs'] },
]

const results = []
for (const step of steps) {
  process.stdout.write(`\n=== Running check: ${step.name} ===\n`)
  const run = spawnSync(step.cmd, step.args, { stdio: 'inherit' })
  results.push({ name: step.name, status: run.status })
}

process.stdout.write('\n=== Check Summary ===\n')
let hasFailure = false
for (const res of results) {
  const ok = res.status === 0
  if (!ok) hasFailure = true
  process.stdout.write(`- ${res.name}: ${ok ? 'PASSED' : 'FAILED (status ' + res.status + ')'}\n`)
}

if (hasFailure) {
  process.exit(1)
}
