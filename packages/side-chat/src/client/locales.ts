export const NS = 'sidechat'
export const zh = {
  branch: '在侧边栏继续', branching: '正在打开侧边栏…', branchUnavailable: '当前消息不是最新回复，无法分出侧边栏对话',
  title: '侧边栏对话', close: '关闭侧边栏',
  reopen: '打开侧边栏对话', empty: '点击回复旁的“在侧边栏继续”，在这里展开独立对话。',
  loading: '正在加载侧边栏对话…', retry: '重试加载', sameSession: '此分支已在主区打开。为避免两个输入框冲突，侧栏暂不显示该会话。',
  inherited: '继承到所选轮次的上下文，后续对话独立进行。', selection: '选择侧边栏分支',
  branchLabel: '分支 {number}', error: '侧边栏未能完成操作：{message}', unsupported: '侧边栏对话无法加载。', nativeNotice: '完整审批、提问、工具详情和附件请在主会话中处理。',
  transcript: '侧边栏消息', input: '侧边栏输入', send: '发送', sending: '发送中…', stop: '停止', stopping: '停止中…',
  loadOlder: '加载更早消息', loadingOlder: '加载中…', pendingInteraction: '此会话需要在主会话处理交互。', openMain: '在主会话处理',
  user: '你', assistant: '助手', context: '上下文', reasoning: '思考', tool: '工具', running: '运行中', settled: '已完成', interrupted: '已中断', failed: '失败', image: '附件',
  pendingInbox: '分支有待执行消息，请先在主会话确认或移除，再发送新消息。', inboxUnavailable: '正在确认分支待执行消息，请稍后重试。',
  referenceMissing: '侧边栏会话未就绪，请重新加载。', disposed: '侧边栏已经关闭。',
}
export const en: Record<keyof typeof zh, string> = {
  branch: 'Continue in Side Panel', branching: 'Opening side panel…', branchUnavailable: 'Only the latest completed turn can be branched to sidebar',
  title: 'Sidebar Chat', close: 'Close Sidebar',
  reopen: 'Open Sidebar Chat', empty: 'Choose “Continue in Side Panel” beside a reply to continue here.',
  loading: 'Loading Sidebar Chat…', retry: 'Retry loading', sameSession: 'This branch is open in the main view. Its side view is paused to avoid duplicate editors.',
  inherited: 'Context through the selected turn is inherited; subsequent conversation is independent.', selection: 'Select a side branch',
  branchLabel: 'Branch {number}', error: 'Sidebar Chat could not finish the operation: {message}', unsupported: 'Sidebar Chat could not load.', nativeNotice: 'Handle approvals, questions, tool details, and attachments in the main conversation.',
  transcript: 'Sidebar Chat messages', input: 'Sidebar Chat input', send: 'Send', sending: 'Sending…', stop: 'Stop', stopping: 'Stopping…',
  loadOlder: 'Load earlier messages', loadingOlder: 'Loading…', pendingInteraction: 'This conversation needs an interaction in the main view.', openMain: 'Handle in main conversation',
  user: 'You', assistant: 'Assistant', context: 'Context', reasoning: 'Reasoning', tool: 'Tool', running: 'Running', settled: 'Finished', interrupted: 'Interrupted', failed: 'Failed', image: 'Attachment',
  pendingInbox: 'This branch has pending input. Review or remove it in the main conversation before sending.', inboxUnavailable: 'Checking the branch pending input. Try again shortly.',
  referenceMissing: 'The side conversation is not ready. Reload it.', disposed: 'Sidebar Chat has closed.',
}
