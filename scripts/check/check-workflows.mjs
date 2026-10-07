import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { load } from 'js-yaml'
for (const file of ['ci', 'release']) {
  const workflow = load(await readFile(new URL('../../.github/workflows/' + file + '.yml', import.meta.url), 'utf8'))
  assert(workflow.on && workflow.jobs)
  for (const job of Object.values(workflow.jobs)) assert(job.steps.some((step) => step.run?.includes('pnpm test:release')))
}
console.log('CI and Release workflow YAML validated')
