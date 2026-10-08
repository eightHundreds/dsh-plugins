import { defineConfig } from 'tsdown'
import { dshCssAssetBridge } from '../../scripts/build/dsh-css-asset-bridge.mjs'

const baseline = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

// The platform loads factory closures, not standalone browser ESM modules.
export default defineConfig({
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
      generateScopedName: 'dsc_[local]_[hash]',
      localsConvention: 'camelCaseOnly',
    },
  },
  plugins: [dshCssAssetBridge()],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({id:"@dshx/side-chat",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
    footer: 'const __DSH_CSS_MODULES__ = "__DSH_CSS_MODULES__";return module.exports;}});',
  },
})
