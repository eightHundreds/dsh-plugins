import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { monaco } from './monaco.ts'

export const THEME_ID = 'dsk-vscode-editor'

/** Resolve CSS variables and color-mix through the browser, then emit Monaco's hex format. */
export function syncTheme(snapshot: ThemeSnapshot): void {
  const dark = snapshot.active.colorScheme === 'dark'
  const probe = document.createElement('span')
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none'
  document.body.append(probe)
  const canvas = document.createElement('canvas').getContext('2d')!
  const color = (token: string, fallback: string): string => {
    probe.style.color = 'var(' + token + ', ' + fallback + ')'
    canvas.clearRect(0, 0, 1, 1)
    canvas.fillStyle = getComputedStyle(probe).color
    canvas.fillRect(0, 0, 1, 1)
    const rgba = canvas.getImageData(0, 0, 1, 1).data
    return '#' + [...rgba].map(value => value.toString(16).padStart(2, '0')).join('')
  }
  try {
    const bg = color('--dsw-alias-bg-layer-1', dark ? '#1e1e1e' : '#ffffff')
    const fg = color('--dsw-alias-label-primary', dark ? '#d4d4d4' : '#242424')
    const muted = color('--dsw-alias-label-tertiary', dark ? '#858585' : '#6e6e6e')
    const border = color('--dsw-alias-border-l2', dark ? '#444444' : '#dddddd')
    const accent = color('--dsw-alias-state-business-primary', '#4076e6')
    const selection = color('--dsw-alias-bg-document-selection', dark ? '#264f78' : '#add6ff')
    monaco.editor.defineTheme(THEME_ID, {
      base: dark ? 'vs-dark' : 'vs', inherit: true,
      rules: [
        { token: 'comment', foreground: color('--shiki-token-comment', muted).slice(1, 7) },
        { token: 'keyword', foreground: color('--shiki-token-keyword', dark ? '#faa2c1' : '#d6336c').slice(1, 7) },
        { token: 'string', foreground: color('--shiki-token-string', dark ? '#69db7c' : '#2f9e44').slice(1, 7) },
        { token: 'number', foreground: color('--shiki-token-constant', dark ? '#4dabf7' : '#1c7ed6').slice(1, 7) },
        { token: 'type', foreground: color('--shiki-token-constant', dark ? '#4dabf7' : '#1c7ed6').slice(1, 7) },
        { token: 'delimiter', foreground: color('--shiki-token-punctuation', fg).slice(1, 7) },
        { token: 'regexp', foreground: color('--shiki-token-string-expression', dark ? '#8ce99a' : '#2b8a3e').slice(1, 7) },
      ],
      colors: {
        'editor.background': bg, 'editor.foreground': fg,
        'editorGutter.background': bg, 'editorLineNumber.foreground': muted,
        'editorLineNumber.activeForeground': fg, 'editorCursor.foreground': accent,
        'editor.selectionBackground': selection, 'editor.inactiveSelectionBackground': selection,
        'editor.lineHighlightBackground': color('--dsw-alias-interactive-bg-hover', '#80808018'),
        'editorIndentGuide.background1': border, 'editorIndentGuide.activeBackground1': muted,
        'editorWidget.background': color('--dsw-alias-bg-layer-2', bg),
        'editorWidget.foreground': fg, 'editorWidget.border': border,
        'editor.findMatchBackground': color('--dsw-alias-state-warn-tertiary', '#e8b84a55'),
        'focusBorder': accent,
        'scrollbarSlider.background': color('--dsw-alias-scrollbar-bg-l1', '#80808066'),
        'scrollbarSlider.hoverBackground': color('--dsw-alias-scrollbar-hover-l1', '#80808099'),
        'editorError.foreground': color('--dsw-alias-state-error-primary', '#e53935'),
        'editorWarning.foreground': color('--dsw-alias-state-warn-primary', '#e8b84a'),
      },
    })
    monaco.editor.setTheme(THEME_ID)
  } finally { probe.remove() }
}
