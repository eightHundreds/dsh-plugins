import * as monaco from 'monaco-editor/editor/editor.api.js'
import './languages.ts'

import 'monaco-editor/editor/browser/coreCommands.js'
import 'monaco-editor/features/find/register.js'
import 'monaco-editor/editor/contrib/find/browser/findController.js'
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js'
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js'
import 'monaco-editor/editor/contrib/folding/browser/folding.js'
import 'monaco-editor/base/browser/ui/codicons/codicon/codicon.css'

export { monaco }
declare const __ASSET_REVISION__: string

/** Restore the previous worker provider on unload, retaining unrelated language workers. */
export function installWorkers(): () => void {
  const previous = globalThis.MonacoEnvironment
  const environment: monaco.Environment = {
    ...previous,
    getWorker(moduleId, label) {
      if (!['editorWorkerService', 'javascript', 'typescript'].includes(label) && previous?.getWorker) {
        return previous.getWorker(moduleId, label)
      }
      const name = 'editor'
      return new Worker(new URL('/vscode-editor/assets/' + name + '.worker.js?v=' + __ASSET_REVISION__, location.href))
    },
  }
  globalThis.MonacoEnvironment = environment
  return () => { if (globalThis.MonacoEnvironment === environment) globalThis.MonacoEnvironment = previous }
}
