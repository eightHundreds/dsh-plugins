import type {} from '@deepseek-ai/dsh-client-ui-slots'

export const NS = 'vscodeEditor'
export const zh = {
  goToDefinition: '转到定义', findReferences: '查找引用', goToImplementation: '转到实现',
  loading: '正在查找…', empty: '没有找到结果', truncated: '仅显示部分结果', close: '关闭结果',
  failed: '语言服务请求失败：{message}', results: '语言服务结果',
}
export const en = {
  goToDefinition: 'Go to Definition', findReferences: 'Find References', goToImplementation: 'Go to Implementation',
  loading: 'Finding results…', empty: 'No results found', truncated: 'Showing partial results', close: 'Close results',
  failed: 'Language service request failed: {message}', results: 'Language service results',
} satisfies Record<keyof typeof zh, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { vscodeEditor: keyof typeof zh }
}
