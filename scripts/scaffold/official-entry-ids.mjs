import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { load, JSON_SCHEMA, Type } from 'js-yaml'

const schema = JSON_SCHEMA.extend(new Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: (value) => ({ __jsExpr: value }),
}))

/** Collect loader entry ids from parsed official bundle patch lists. */
export function collectOfficialEntryIds(patchLists) {
  const ids = new Set()
  const walk = (row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return
    if (typeof row.id === 'string' && row.id) ids.add(row.id)
    if (Array.isArray(row.insert)) {
      for (const child of row.insert) walk(child)
    }
    if (row.group && Array.isArray(row.config)) {
      for (const child of row.config) walk(child)
    }
  }
  for (const list of patchLists) {
    if (!Array.isArray(list)) continue
    for (const row of list) walk(row)
  }
  return ids
}

export async function readPatchFile(path) {
  const rows = load(await readFile(path, 'utf8'), { schema }) ?? []
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error(`${path}: expected a patch list`)
  }
  return rows
}

/** Load official bundle patches from each packages/bundle/<name>/cordis.patch.yml. */
export async function loadOfficialEntryIds(harnessRoot) {
  const bundleRoot = resolve(harnessRoot, 'packages/bundle')
  let entries
  try {
    entries = await readdir(bundleRoot, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Official DSH checkout not found at ${harnessRoot}. Clone deepseek-harness beside this repo, or set DSH_HARNESS.`,
      )
    }
    throw error
  }
  const lists = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = resolve(bundleRoot, entry.name, 'cordis.patch.yml')
    try {
      lists.push(await readPatchFile(path))
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
  }
  if (lists.length === 0) {
    throw new Error(`No official bundle patches found under ${bundleRoot}`)
  }
  return collectOfficialEntryIds(lists)
}
