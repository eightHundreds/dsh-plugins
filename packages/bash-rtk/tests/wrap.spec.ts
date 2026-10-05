import { describe, expect, it } from 'vitest'
import { wrapWithRtk } from '../src/wrap.ts'

describe('wrapWithRtk', () => {
  describe('rtk unavailable', () => {
    it('passes every command through unchanged', () => {
      expect(wrapWithRtk('git status', false)).toBe('git status')
      expect(wrapWithRtk('cargo build --release', false)).toBe('cargo build --release')
      expect(wrapWithRtk('ls -al', false)).toBe('ls -al')
    })
  })

  describe('unsupported or builtin commands pass through unchanged', () => {
    it('echo and shell commands without rtk rewrite', () => {
      expect(wrapWithRtk('echo hello', true)).toBe('echo hello')
      expect(wrapWithRtk('sudo git status', true)).toBe('sudo git status')
      expect(wrapWithRtk('GIT status', true)).toBe('GIT status')
    })
  })

  describe('supported commands are rewritten by RTK engine', () => {
    it('ls', () => {
      expect(wrapWithRtk('ls -al', true)).toBe('rtk ls -al')
    })

    it('git', () => {
      expect(wrapWithRtk('git status', true)).toBe('rtk git status')
    })

    it('cargo', () => {
      expect(wrapWithRtk('cargo build --release', true)).toBe('rtk cargo build --release')
    })

    it('preserves arguments verbatim', () => {
      expect(wrapWithRtk('git log --oneline -10', true)).toBe('rtk git log --oneline -10')
    })

    it('rewrites compound or piped commands', () => {
      expect(wrapWithRtk('git status | grep modified', true)).toBe('git status | rtk grep modified')
      expect(wrapWithRtk('cd src; git status', true)).toBe('cd src; rtk git status')
    })
  })

  describe('edge cases', () => {
    it('empty command passes through', () => {
      expect(wrapWithRtk('', true)).toBe('')
    })
    it('whitespace-only command passes through', () => {
      expect(wrapWithRtk('   ', true)).toBe('   ')
    })
    it('trims command appropriately when rewritten', () => {
      expect(wrapWithRtk('  git status', true)).toBe('rtk git status')
    })
  })
})

