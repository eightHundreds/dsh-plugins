import type { ToolExecution } from '@deepseek-ai/dsh-tools'

export function sessionCwd(exec: ToolExecution): string | undefined {
  return exec.agent?.session.header.cwd
}
