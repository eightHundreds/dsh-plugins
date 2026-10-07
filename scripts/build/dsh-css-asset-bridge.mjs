import { readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** Adapt tsdown's extracted CSS asset to DSH's single-bundle client contract. */
export function dshCssAssetBridge({ marker = '__DSH_CSS_MODULES__' } = {}) {
  return {
    name: 'dsh-css-asset-bridge',
    async writeBundle(outputOptions, bundle) {
      const cssAssets = Object.values(bundle).filter(
        item => item.type === 'asset' && typeof item.fileName === 'string' && item.fileName.endsWith('.css'),
      )
      if (cssAssets.length === 0) return
      if (cssAssets.length !== 1) throw new Error(`Expected one CSS asset, found ${cssAssets.length}`)
      const entries = Object.values(bundle).filter(item => item.type === 'chunk' && item.isEntry)
      if (entries.length !== 1) throw new Error(`Expected one DSH client entry, found ${entries.length}`)
      if (!outputOptions.dir) throw new Error('Cannot inline CSS when tsdown output is not a directory')

      const cssPath = resolve(outputOptions.dir, cssAssets[0].fileName)
      const jsPath = resolve(outputOptions.dir, entries[0].fileName)
      const [css, js] = await Promise.all([readFile(cssPath, 'utf8'), readFile(jsPath, 'utf8')])
      const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const token = new RegExp(`(["'\\x60])${escapedMarker}\\1`, 'g')
      const matches = [...js.matchAll(token)]
      if (matches.length !== 1) {
        throw new Error(`Expected one CSS marker value in ${entries[0].fileName}, found ${matches.length}`)
      }
      const match = matches[0]
      await writeFile(jsPath, js.slice(0, match.index) + JSON.stringify(css) + js.slice(match.index + match[0].length))
      await rm(cssPath)
    },
  }
}
