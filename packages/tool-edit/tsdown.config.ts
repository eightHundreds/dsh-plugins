import type { UserConfig } from 'tsdown'

export default {
  entry: {
    index: 'src/index.ts',
    invariant: 'src/invariant.ts',
    hashline: 'src/hashline-engine/index.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
  deps: { neverBundle: [/^@deepseek-ai\//, '@dshx/lsp'] },
} satisfies UserConfig
