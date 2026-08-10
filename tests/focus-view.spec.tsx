// @vitest-environment jsdom
/** FocusView behavior: condensed flow rows, Think auto-expand/fold, running status, folded tool groups with full card expansion. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ChatConversationViewNode, ConversationSnapshot, RunningToolCall, SessionId, SessionListState,
  ToolResultNode, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { FocusView, type FocusViewProps } from '../src/client/FocusView.tsx'
import type { FocusScrollPosition } from '../src/client/FocusView.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const SID = 's1' as SessionId
const t = makeTranslate(zh, commonZh)

/** Minimal chat view node: FocusView only reads key/kind/visibility/data. */
function chatNode(
  key: string,
  kind: string,
  data: unknown,
  location: ChatConversationViewNode['location'] = { kind: 'unresolved' },
): NonNullable<ReturnType<ConversationSnapshot['chat']['nodes']['get']>> {
  return {
    key, kind, id: key, target: 'chat', anchorSeq: 1,
    location,
    visibility: 'visible',
    data,
  } as never
}

function settledCall(callId: string, name: string, argsRaw: string, overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 2, time: 3000, callId, call: { name, argsRaw }, callTime: 1000,
    content: [], isError: false, callView: null, resultView: null, subCalls: [],
    ...overrides,
  }
}

function runningCall(callId: string, name: string, argsRaw = '{}'): RunningToolCall {
  return { callId, name, argsRaw, turn: 1, step: 1, time: 1000, callView: null, subCalls: [] }
}

function sessionsStore(cwd: string | undefined) {
  return createSnapshotStore<SessionListState>({
    ids: [SID],
    byId: { [SID]: { id: SID, cwd } } as SessionListState['byId'],
    current: SID,
    phase: 'ready',
    subagentsByParent: {},
    currentAddress: undefined,
  })
}

function workspacesStore() {
  return createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true,
    recentWorkspaceId: undefined,
  })
}

type ChatSlice = Pick<ConversationSnapshot, 'chat' | 'running' | 'hasMore' | 'loadingOlder' | 'queue' | 'openState' | 'openError'>

function chatOf(nodes: ReturnType<typeof chatNode>[], opts: { running?: boolean; hasMore?: boolean; loadingOlder?: boolean; queue?: ConversationSnapshot['queue']; openState?: ConversationSnapshot['openState']; openError?: ConversationSnapshot['openError'] } = {}): ChatSlice {
  const nodesByKey = new Map(nodes.map(n => [n.key, n]))
  return {
    running: opts.running ?? false,
    hasMore: opts.hasMore ?? false,
    loadingOlder: opts.loadingOlder ?? false,
    queue: opts.queue ?? [],
    openState: opts.openState ?? 'cold',
    openError: opts.openError ?? null,
    chat: {
      order: nodes.map(n => n.key),
      nodes: {
        get: (key: string) => nodesByKey.get(key),
        values: () => nodes,
      },
      locations: { getTurn: () => [], getStep: () => [] },
      timeline: { turnOrder: [], turns: new Map() },
      legacy: {
        nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
      },
    },
  }
}

function renderView(nodes: ReturnType<typeof chatNode>[], opts: {
  cwd?: string
  loadOlder?: () => void
  openFile?: (path: string) => void
  forkAt?: (seq: number) => void
  fileMentions?: (owner: unknown) => unknown
  chat?: ChatSlice
  t?: FocusViewProps['t']
  scroll?: { save: (position: FocusScrollPosition | null) => void; read: () => FocusScrollPosition | null }
} = {}): {
  result: ReturnType<typeof render>
  source: ReturnType<typeof createSnapshotStore<ChatSlice>>
} {
  const source = createSnapshotStore<ChatSlice>(opts.chat ?? chatOf(nodes))
  const props = {
    sessionId: SID,
    useSession: bindSnapshotSelector(source),
    useSessions: bindSnapshotSelector(sessionsStore(opts.cwd)),
    useWorkspaces: bindSnapshotSelector(workspacesStore()),
    useProjection: (() => undefined) as never,
    loadOlder: opts.loadOlder ?? (() => {}),
    openFile: opts.openFile ?? (() => {}),
    forkAt: opts.forkAt ?? (() => {}),
    fileMentions: opts.fileMentions ?? (() => undefined),
    scroll: opts.scroll ?? { save: () => {}, read: () => null },
    t: opts.t ?? t,
  } as unknown as FocusViewProps
  return { result: render(<FocusView {...props} />), source }
}

function assistantNode(key: string, status: 'running' | 'settled', reasoning: string, time: number): ReturnType<typeof chatNode> {
  return chatNode(key, 'assistant-step', {
    status, turn: 1, step: 1, time,
    blocks: reasoning === '' ? [] : [{ kind: 'reasoning', text: reasoning }],
    ...(status === 'settled'
      ? {
        finalNode: {
          kind: 'assistant', seq: 5, time, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: time - 2000, firstTokenTime: time - 700, completedTime: time },
        },
      }
      : {}),
  })
}

describe('FocusView flow rows', () => {
  it('renders the empty hint for an empty conversation', () => {
    renderView([])
    expect(screen.getByText('暂无消息')).toBeTruthy()
  })

  it('renders user text and assistant text with a Think row carrying the duration', () => {
    renderView([
      chatNode('u1', 'user', { kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'hello' }], source: null }),
      assistantNode('a1', 'settled', 'think line one\nline two', 3000),
      chatNode('a2', 'assistant-step', {
        status: 'settled', turn: 1, step: 2, time: 3000,
        blocks: [{ kind: 'text', text: 'answer text' }],
      }),
    ])
    expect(screen.getByText('hello')).toBeTruthy()
    expect(screen.getByText('answer text')).toBeTruthy()
    expect(screen.getByText('思考了 1.3 秒')).toBeTruthy()
  })

  it('keeps the plain Think title while running or without timing', () => {
    renderView([
      assistantNode('a1', 'running', 'streaming', 100),
    ])
    expect(screen.getByText('思考')).toBeTruthy()
  })

  it('keeps the Think row to one line, tail-previewing the streaming text, and settles to the first line', () => {
    const { source } = renderView([
      assistantNode('a1', 'running', 'first line\nsecond line', 100),
    ])
    // Default one line (chat semantics): only the streaming tail previews.
    expect(screen.queryByText('first line')).toBeNull()
    expect(screen.getByText('second line')).toBeTruthy()
    // Expanding reveals the full reasoning body.
    fireEvent.click(screen.getByText('second line'))
    expect(screen.getByText(/first line/)).toBeTruthy()
    expect(screen.getByText(/second line/)).toBeTruthy()
    // Completion flips the one-line summary back to the first line and the
    // duration title appears (the manual expansion stays open).
    act(() => {
      source.set(chatOf([
        assistantNode('a1', 'settled', 'first line\nsecond line', 3000),
      ]))
    })
    expect(screen.getByText('思考了 1.3 秒')).toBeTruthy()
    expect(screen.getByText(/first line/)).toBeTruthy()
    fireEvent.click(screen.getByText('思考了 1.3 秒'))
    expect(screen.queryByText(/second line/)).toBeNull()
    expect(screen.getByText('first line')).toBeTruthy()
  })

  it('renders a settled reasoning block above its reply text', () => {
    renderView([
      chatNode('a1', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 3000,
        blocks: [
          { kind: 'reasoning', text: 'think line' },
          { kind: 'text', text: 'final answer' },
        ],
        finalNode: {
          kind: 'assistant', seq: 5, time: 3000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 1000, firstTokenTime: 1500, completedTime: 3000 },
        },
      }),
    ])
    // Blocks keep their logged order (the chat AssistantMarkdown rule): the
    // Thought row sits above the reply, never below it.
    const column = document.querySelector('[data-focus-flow]')?.textContent ?? ''
    expect(column.indexOf('思考了 0.5 秒')).toBeLessThan(column.indexOf('final answer'))
  })

  it('stops tail-previewing the Think row once the assistant starts its text reply', () => {
    const { source } = renderView([
      chatNode('a1', 'assistant-step', {
        status: 'running', turn: 1, step: 1, time: 100,
        blocks: [{ kind: 'reasoning', text: 'thinking\nmore' }],
      }),
    ])
    // Pure thinking phase: the tail previews on the one-line row.
    expect(screen.getByText('more')).toBeTruthy()
    act(() => {
      source.set(chatOf([
        chatNode('a1', 'assistant-step', {
          status: 'running', turn: 1, step: 1, time: 100,
          blocks: [
            { kind: 'reasoning', text: 'thinking\nmore' },
            { kind: 'text', text: '正在写回答' },
          ],
        }),
      ]))
    })
    // The reply started: the reasoning is no longer the streaming tail and
    // the summary flips to the first line.
    expect(screen.getByText('thinking')).toBeTruthy()
    expect(screen.queryByText('more')).toBeNull()
  })

  it('refreshes the Think summary on assistant-only publications with a stable order reference', () => {
    // Regression: an assistant-only publication (no new nodes) must still
    // refresh the flow — the order handle reference never moves in that case.
    const order = ['a1']
    const runningNode = assistantNode('a1', 'running', 'one\ntwo', 100)
    const settledNode = assistantNode('a1', 'settled', 'one\ntwo', 3000)
    const nodesByKey = new Map<string, ReturnType<typeof chatNode>>([['a1', runningNode]])
    const source = createSnapshotStore<ChatSlice>({
      running: true,
      hasMore: false,
      loadingOlder: false,
      queue: [],
      openState: 'cold',
      openError: null,
      chat: {
        order,
        nodes: { get: (k: string) => nodesByKey.get(k), values: () => [runningNode] },
        locations: { getTurn: () => [], getStep: () => [] },
        timeline: { turnOrder: [], turns: new Map() },
        legacy: { nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [] },
      },
    })
    render(<FocusView {...({
      sessionId: SID,
      useSession: bindSnapshotSelector(source),
      useSessions: bindSnapshotSelector(sessionsStore(undefined)),
      useWorkspaces: bindSnapshotSelector(workspacesStore()),
      useProjection: (() => undefined) as never,
      loadOlder: () => {},
      openFile: () => {},
      forkAt: () => {},
      fileMentions: (() => undefined) as never,
      scroll: { save: () => {}, read: () => null },
      t,
    } as unknown as FocusViewProps)} />)
    expect(screen.getByText('two')).toBeTruthy()
    act(() => {
      // Same `order` array reference; the node store returns the settled node.
      nodesByKey.set('a1', settledNode)
      source.set({
        running: false,
        hasMore: false,
        loadingOlder: false,
        queue: [],
        openState: 'cold',
        openError: null,
        chat: {
          order,
          nodes: { get: (k: string) => nodesByKey.get(k), values: () => [settledNode] },
          locations: { getTurn: () => [], getStep: () => [] },
          timeline: { turnOrder: [], turns: new Map() },
          legacy: { nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [] },
        },
      })
    })
    expect(screen.queryByText('two')).toBeNull()
    expect(screen.getByText('one')).toBeTruthy()
    expect(screen.getByText('思考了 1.3 秒')).toBeTruthy()
  })

  it('tail-preview only the last reasoning block while the step streams', () => {
    renderView([
      chatNode('a1', 'assistant-step', {
        status: 'running', turn: 1, step: 1, time: 100,
        blocks: [
          { kind: 'reasoning', text: 'first think\nmore one' },
          { kind: 'reasoning', text: 'second think\nmore two' },
        ],
      }),
    ])
    expect(screen.getByText('more two')).toBeTruthy()
    expect(screen.queryByText('more one')).toBeNull()
  })

  it('marks the running Think row with the sweep animation state', () => {
    renderView([assistantNode('a1', 'running', 'streaming', 100)])
    const row = screen.getByText('思考')
    const wrap = row.closest('[data-state]')
    expect(wrap?.getAttribute('data-state')).toBe('running')
    expect(wrap?.querySelector('.thinkRowInner, [data-disclosure-row]')).toBeTruthy()
  })

  it('absorbs the preceding reasoning into the group and lets its line carry the thinking metric', () => {
    renderView([
      assistantNode('a1', 'settled', 'think text\nmore', 3000),
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{"command":"build"}') }),
    ])
    // Collapsed: one summary line only — no standalone Think row remains.
    expect(screen.getByText('思考了 1.3 秒，运行了 1 个命令')).toBeTruthy()
    expect(screen.queryByText('思考')).toBeNull()
    fireEvent.click(screen.getByText('思考了 1.3 秒，运行了 1 个命令'))
    // The Think row sits inside the group: plain title, one-line summary.
    expect(screen.getByText('思考')).toBeTruthy()
    expect(screen.getByText('think text')).toBeTruthy()
    expect(screen.queryByText('more')).toBeNull()
    // Expanding the Think row reveals the reasoning body next to the call row.
    fireEvent.click(screen.getByText('思考'))
    expect(screen.getByText(/more/)).toBeTruthy()
  })

  it('keeps the assistant text beside the group while its reasoning moves inside', () => {
    renderView([
      chatNode('a1', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 3000,
        blocks: [
          { kind: 'reasoning', text: 'think text' },
          { kind: 'text', text: 'answer text' },
        ],
      }),
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
    ])
    // The reply text stays as its own flow row; no standalone Think row.
    expect(screen.getByText('answer text')).toBeTruthy()
    expect(screen.queryByText('思考')).toBeNull()
    // The folded group renders ABOVE the reply (thinking precedes the text);
    // the reply keeps the runs around it from merging.
    const column = document.querySelector('[data-focus-flow]')?.textContent ?? ''
    expect(column.indexOf('运行了 1 个命令')).toBeLessThan(column.indexOf('answer text'))
    fireEvent.click(screen.getByText('运行了 1 个命令'))
    // The Think row lives inside the expanded group.
    expect(screen.getByText('思考')).toBeTruthy()
    expect(screen.getByText('think text')).toBeTruthy()
  })

  it('aggregates command, search, and exploration metrics into the group line', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'web_search', '{}') }),
      chatNode('t3', 'tool-call', { root: settledCall('c3', 'read', '{}') }),
      chatNode('t4', 'tool-call', { root: settledCall('c4', 'glob', '{}') }),
    ])
    expect(screen.getByText('运行了 1 个命令，搜索了 1 次，读取了 1 个文件，列出了 1 个目录')).toBeTruthy()
  })

  it('appends a failure tally to a mixed family in the summary line', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'bash', '{}', {
        isError: true, error: { name: 'Error', code: 'boom' },
      }) }),
    ])
    expect(screen.getByText('运行了 1 个命令（1 次失败）')).toBeTruthy()
  })

  it('reads a fully failed family as its singular phrase or an all-failed suffix', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}', {
        isError: true, error: { name: 'Error', code: 'boom' },
      }) }),
    ])
    expect(screen.getByText('命令失败')).toBeTruthy()
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}', {
        isError: true, error: { name: 'Error', code: 'boom' },
      }) }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'bash', '{}', {
        isError: true, error: { name: 'Error', code: 'boom' },
      }) }),
    ])
    expect(screen.getByText('运行了 2 个命令（全部失败）')).toBeTruthy()
  })

  it('shows a dirs-only exploration metric, write/edit families, and the total-count fallback', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'glob', '{}') }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'write', '{}') }),
    ])
    expect(screen.getByText('写入了 1 个文件，列出了 1 个目录')).toBeTruthy()
    renderView([
      chatNode('t3', 'tool-call', { root: settledCall('c3', 'edit', '{}') }),
    ])
    expect(screen.getByText('编辑了 1 次')).toBeTruthy()
    renderView([
      chatNode('t4', 'tool-call', { root: settledCall('c4', 'run_code', '{}') }),
    ])
    expect(screen.getByText('调用了 1 个工具')).toBeTruthy()
  })

  it('folds a run of tool calls into one summary line and expands into call rows', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{"command":"pnpm build"}', {
        content: [{ type: 'text', text: 'built ok' }],
      }) }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'read', '{"path":"/ws/a.ts"}', {
        callTime: 1200,
        content: [{ type: 'text', text: 'line 1' }],
      }) }),
    ], { cwd: '/ws' })
    const summary = screen.getByText('运行了 1 个命令，读取了 1 个文件')
    expect(summary).toBeTruthy()
    // Collapsed: no call rows yet (the chat row titles).
    expect(screen.queryByText('Bash')).toBeNull()
    fireEvent.click(summary)
    // The chat row shape: variant title + args summary (path link for the read).
    const bashRow = screen.getByText('Bash')
    expect(bashRow).toBeTruthy()
    expect(screen.getByText('pnpm build')).toBeTruthy()
    expect(screen.getByText('Read')).toBeTruthy()
    expect(screen.getByText('a.ts')).toBeTruthy()
    // Expand one call: the IN/OUT card with args and output.
    fireEvent.click(bashRow)
    expect(screen.getByText('built ok')).toBeTruthy()
    expect(screen.getByText('{', { exact: false })).toBeTruthy()
  })

  it('picks the leading icon by tool family and keeps state dots for failures', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'read', '{}') }),
      chatNode('t3', 'tool-call', { root: settledCall('c3', 'web_search', '{}') }),
      chatNode('t4', 'tool-call', { root: settledCall('c4', 'write', '{}') }),
      chatNode('t5', 'tool-call', { root: settledCall('c5', 'edit', '{}') }),
      chatNode('t6', 'tool-call', { root: settledCall('c6', 'run_code', '{}') }),
      chatNode('t7', 'tool-call', { root: settledCall('c7', 'todo_write', '{}') }),
      chatNode('t8', 'tool-call', { root: settledCall('c8', 'bash', '{"command":"x"}', {
        isError: true, error: { name: 'Error', code: 'boom' },
        content: [{ type: 'text', text: 'boom' }],
      }) }),
    ])
    fireEvent.click(screen.getByText('运行了 1 个命令（1 次失败），写入了 1 个文件，编辑了 1 次，搜索了 1 次，读取了 1 个文件，调用了 2 个工具'))
    // Chat row titles per variant; the unknown tool keeps the static title.
    const rowOf = (title: string, index = 0) => screen.getAllByText(title)[index]?.closest('[data-disclosure-row]')
    expect(rowOf('Bash', 0)?.querySelector('[data-tool-icon="bash"]')).toBeTruthy()
    expect(rowOf('Read')?.querySelector('[data-tool-icon="read"]')).toBeTruthy()
    expect(rowOf('Search')?.querySelector('[data-tool-icon="search"]')).toBeTruthy()
    expect(rowOf('Write')?.querySelector('[data-tool-icon="write"]')).toBeTruthy()
    expect(rowOf('Edit')?.querySelector('[data-tool-icon="edit"]')).toBeTruthy()
    expect(rowOf('Code')?.querySelector('[data-tool-icon="code"]')).toBeTruthy()
    expect(rowOf('Tool call')?.querySelector('[data-tool-icon="others"]')).toBeTruthy()
    // The failing call keeps the red state dot, not the family icon.
    expect(screen.getByText('boom').closest('[data-disclosure-row]')?.querySelector('[data-tool-icon]')).toBeNull()
  })

  it('renders the running call as a tail under the collapsed summary line', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: runningCall('c1', 'bash') }),
    ])
    // The group stays collapsed with the running call as its live tail —
    // one stable flow row, no card open.
    expect(screen.getByText('运行了 1 个命令')).toBeTruthy()
    expect(screen.getByText('Bash')).toBeTruthy()
    expect(screen.getAllByText('{}').length).toBe(1)
    expect(screen.queryByText('输入')).toBeNull()
    const row = screen.getByText('Bash').closest('[data-state]')
    expect(row?.getAttribute('data-state')).toBe('running')
  })

  it('keeps the running call as a tail and folds it into the group once settled', () => {
    const { source } = renderView([
      assistantNode('a1', 'settled', 't', 3000),
      chatNode('t1', 'tool-call', { root: runningCall('c1', 'bash', '{"command":"pnpm build"}') }),
    ])
    // While the call runs: the summary line with the live tail below it.
    expect(screen.getByText('思考了 1.3 秒，运行了 1 个命令')).toBeTruthy()
    expect(screen.getByText('Bash')).toBeTruthy()
    expect(screen.getByText('pnpm build')).toBeTruthy()
    act(() => {
      source.set(chatOf([
        assistantNode('a1', 'settled', 't', 3000),
        chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
      ]))
    })
    // Once settled the tail folds in: the summary line stays, the tail is gone.
    expect(screen.queryByText('Bash')).toBeNull()
    expect(screen.getByText('思考了 1.3 秒，运行了 1 个命令')).toBeTruthy()
  })


  it('lets the terminal description and search title outrank the args summary', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{"command":"pnpm build"}', {
        callView: { card: 'terminal', title: 'pnpm build', description: 'Build the app' },
        resultView: { card: 'terminal', output: 'built ok', exitCode: 0 },
      }) }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'web_search', '{"query":"x"}', {
        resultView: { card: 'search', shape: 'paths', paths: [], truncated: false, total: 0, title: 'Search results' },
      }) }),
    ])
    // Expand the group first: the rows carry the chat outranking summaries.
    fireEvent.click(screen.getByText('运行了 1 个命令，搜索了 1 次'))
    expect(screen.getByText('Build the app')).toBeTruthy()
    expect(screen.getByText('Search results')).toBeTruthy()
    expect(screen.queryByText('pnpm build')).toBeNull()
  })

  it('surfaces a failing terminal exit as the row red dot', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}', {
        callView: { card: 'terminal', title: 'build' },
        resultView: { card: 'terminal', output: 'boom', exitCode: 2 },
      }) }),
    ])
    fireEvent.click(screen.getByText('命令失败'))
    const row = screen.getByText('Bash').closest('[data-state]')
    expect(row?.getAttribute('data-state')).toBe('error')
  })

  it('shows the error first line on failed calls', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}', {
        isError: true, error: { name: 'Error', code: 'boom' },
        content: [{ type: 'text', text: 'failed line\nrest' }],
      }) }),
    ])
    fireEvent.click(screen.getByText('命令失败'))
    const row = screen.getByText('Bash')
    // The error row's collapsed summary IS the failure's first line.
    expect(screen.getAllByText('failed line').length).toBeGreaterThan(0)
    fireEvent.click(row)
    // The expanded IN/OUT card keeps the error output and shows the args.
    expect(screen.getAllByText('failed line').length).toBeGreaterThan(0)
    expect(screen.getByText('{}')).toBeTruthy()
  })

  it('renders command, compaction, retry, and turn-error rows with the chat chrome', () => {
    renderView([
      chatNode('cmd', 'command', {
        kind: 'command', seq: 1, time: 1, commandId: 'cmd1', name: 'compact', args: ' --soft',
        outcome: { kind: 'success', text: 'done line' },
      }),
      chatNode('comp', 'compaction', {
        kind: 'compaction', seq: 2, time: 2, summary: 'sum text', summaryEventSeq: 3,
        shadowedItemCount: 4, shadowedTokenCount: 5,
      }),
      chatNode('retry', 'model-retry', {
        attempts: [],
        current: {
          retryId: 'r1', turn: 1, step: 1, provider: 'x', mode: 'normal', policyKey: 'p',
          retry: 1, maxRetries: 3, delayMs: 3000,
          failure: { name: 'Error', message: 'boom' },
          kind: 'model-retry', seq: 3, time: 3, retryState: 'scheduled',
        },
      }),
      chatNode('err', 'turn-error', { kind: 'turn-error', seq: 4, time: 4, turn: 1, step: 1, message: 'boom' }),
      chatNode('weird', 'future-kind', { hello: 1 }),
    ])
    // The command row reads `name · settlement` (the chat GenericCommandCard).
    expect(screen.getByText('compact')).toBeTruthy()
    expect(screen.getByText('done line')).toBeTruthy()
    // The compaction marker aggregates the structured counts.
    expect(screen.getByText('上下文已压缩')).toBeTruthy()
    expect(screen.getByText('已压缩 4 条历史记录（约 5 tokens）')).toBeTruthy()
    // The retry row counts down (scheduled → shimmer) and expands to details.
    expect(screen.getByText('等待重试模型请求（1/3） · 3s')).toBeTruthy()
    fireEvent.click(screen.getByText('等待重试模型请求（1/3） · 3s'))
    expect(screen.getByText('重试延迟：')).toBeTruthy()
    expect(screen.getByText('失败原因：')).toBeTruthy()
    // The failure message appears in the retry details and the turn error.
    expect(screen.getAllByText('boom').length).toBe(2)
    expect(screen.getByText('本轮运行失败')).toBeTruthy()
    expect(screen.getByRole('button', { name: /future-kind/ })).toBeTruthy()
  })

  it('renders the user message as a bubble with ref chips, clock, and copy', () => {
    renderView([
      chatNode('u1', 'user', {
        kind: 'user', seq: 1, time: 1,
        content: [{ type: 'text', text: 'hello /compact world @sub1' }], source: null,
      }),
    ])
    expect(screen.getByText('hello')).toBeTruthy()
    expect(screen.getByText('/compact')).toBeTruthy()
    expect(screen.getByText('@sub1')).toBeTruthy()
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('merges directly-consecutive runs into one summary line', () => {
    renderView([
      assistantNode('a1', 'settled', 'first think\nmore one', 3000),
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{"command":"build"}') }),
      assistantNode('a2', 'settled', 'second think\nmore two', 4000),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'bash', '{"command":"test"}') }),
      chatNode('t3', 'tool-call', { root: settledCall('c3', 'bash', '{"command":"lint"}') }),
    ])
    // One merged summary line: thought and command metrics aggregate.
    expect(screen.getByText('思考了 2.6 秒，运行了 3 个命令')).toBeTruthy()
    fireEvent.click(screen.getByText('思考了 2.6 秒，运行了 3 个命令'))
    // The folded rows keep flow order: each think sits above its own calls.
    const calls = document.querySelector('[data-calls]')
    const text = calls?.textContent ?? ''
    expect(text.indexOf('first think')).toBeLessThan(text.indexOf('build'))
    expect(text.indexOf('build')).toBeLessThan(text.indexOf('second think'))
    expect(text.indexOf('second think')).toBeLessThan(text.indexOf('test'))
    expect(text.indexOf('test')).toBeLessThan(text.indexOf('lint'))
  })

  it('folds a completed turn into one worked line, keeping the closing reply', () => {
    const turn = {
      turn: 1,
      start: { time: 1000 },
      end: { time: 8000 },
      status: 'closed',
      steps: [],
      data: { get: () => undefined },
    }
    const at = (key: string, kind: string, data: unknown) => chatNode(key, kind, data, { kind: 'turn', turn } as never)
    renderView([
      chatNode('u1', 'user', {
        kind: 'user', seq: 1, time: 1,
        content: [{ type: 'text', text: 'go' }], source: null,
      }),
      at('a1', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 2000,
        blocks: [{ kind: 'reasoning', text: 'r1\nr2' }],
        finalNode: {
          kind: 'assistant', seq: 10, time: 2000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 1000, firstTokenTime: 1500, completedTime: 2000 },
        },
      }),
      at('t1', 'tool-call', { root: settledCall('c1', 'bash', '{"command":"build"}') }),
      at('c1', 'context', {
        kind: 'context', seq: 5, time: 5000,
        content: [{ type: 'text', text: 'injected rules' }],
        source: { kind: 'file' }, provenance: { role: 'instructions', label: 'AGENTS.md' }, form: null,
      }),
      at('a2', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 8000,
        blocks: [{ kind: 'text', text: 'all done' }],
        finalNode: {
          kind: 'assistant', seq: 20, time: 8000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 6000, firstTokenTime: 7000, completedTime: 8000 },
        },
      }),
    ])
    // The completed turn folds: the work line stays, the closing reply stays,
    // and the context injection folds too.
    expect(screen.getByText('工作了 7 秒')).toBeTruthy()
    expect(screen.getByText('all done')).toBeTruthy()
    expect(screen.queryByText(/运行了 1 个命令/)).toBeNull()
    expect(screen.queryByText('injected rules')).toBeNull()
    expect(screen.queryByText('go')).toBeTruthy()
    // Expanding the fold reveals the folded rows — the context injection
    // and the group; expanding the group reveals the absorbed think.
    fireEvent.click(screen.getByText('工作了 7 秒'))
    expect(screen.getByText('思考了 0.5 秒，运行了 1 个命令')).toBeTruthy()
    // The context injection row is inside the fold; expanding it reveals its
    // code-block card body.
    fireEvent.click(screen.getByText('上下文注入'))
    expect(screen.getByText('injected rules')).toBeTruthy()
    fireEvent.click(screen.getByText('思考了 0.5 秒，运行了 1 个命令'))
    expect(screen.getByText('思考')).toBeTruthy()
  })

  it("folds the closing reply's own reasoning into the worked line", () => {
    const turn = {
      turn: 1,
      start: { time: 1000 },
      end: { time: 8000 },
      status: 'closed',
      steps: [],
      data: { get: () => undefined },
    }
    const at = (key: string, kind: string, data: unknown) => chatNode(key, kind, data, { kind: 'turn', turn } as never)
    renderView([
      at('u1', 'user', {
        kind: 'user', seq: 1, time: 1,
        content: [{ type: 'text', text: 'go' }], source: null,
      }),
      at('a1', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 8000,
        blocks: [
          { kind: 'reasoning', text: 'closing think' },
          { kind: 'text', text: 'all done' },
        ],
        finalNode: {
          kind: 'assistant', seq: 20, time: 8000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 6000, firstTokenTime: 7600, completedTime: 8000 },
        },
      }),
    ])
    // The completed turn folds its own closing thought: no standalone Think
    // row beside the reply.
    expect(screen.getByText('工作了 7 秒')).toBeTruthy()
    expect(screen.getByText('all done')).toBeTruthy()
    expect(screen.queryByText('思考')).toBeNull()
    // Expanding the fold reveals the folded reasoning with its duration.
    fireEvent.click(screen.getByText('工作了 7 秒'))
    expect(screen.getByText('思考了 1.6 秒')).toBeTruthy()
    expect(screen.getByText('closing think')).toBeTruthy()
  })

  it('folds each interjection-delimited stretch with its own worked duration', () => {
    const turn = {
      turn: 1,
      start: { time: 1000 },
      end: { time: 8000 },
      status: 'closed',
      steps: [],
      data: { get: () => undefined },
    }
    const at = (key: string, kind: string, data: unknown) => chatNode(key, kind, data, { kind: 'turn', turn } as never)
    renderView([
      at('u1', 'user', {
        kind: 'user', seq: 1, time: 1,
        content: [{ type: 'text', text: 'go' }], source: null,
      }),
      at('a1', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 2000,
        blocks: [{ kind: 'reasoning', text: 'think one' }],
        finalNode: {
          kind: 'assistant', seq: 10, time: 2000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 1000, firstTokenTime: 1500, completedTime: 2000 },
        },
      }),
      at('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
      at('s1', 'steering', {
        kind: 'steering', seq: 5, time: 3000,
        content: [{ type: 'text', text: 'wait no' }], source: null,
      }),
      at('a2', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 4500,
        blocks: [{ kind: 'reasoning', text: 'think two' }],
        finalNode: {
          kind: 'assistant', seq: 15, time: 4500, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 3500, firstTokenTime: 4000, completedTime: 4500 },
        },
      }),
      at('t2', 'tool-call', { root: settledCall('c2', 'bash', '{}') }),
      at('a3', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 7000,
        blocks: [{ kind: 'text', text: 'fixed it' }],
        finalNode: {
          kind: 'assistant', seq: 20, time: 7000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 6500, firstTokenTime: 6700, completedTime: 7000 },
        },
      }),
    ])
    // Each stretch folds with its own duration: turn start → interjection
    // (1000→3000 = 2s) and interjection → turn end (3000→8000 = 5s); the
    // interjection itself stays visible, and the closing reply stays out.
    expect(screen.getByText('工作了 2 秒')).toBeTruthy()
    expect(screen.getByText('工作了 5 秒')).toBeTruthy()
    expect(screen.queryByText('工作了 7 秒')).toBeNull()
    expect(screen.getByText('wait no')).toBeTruthy()
    expect(screen.getByText('fixed it')).toBeTruthy()
    expect(screen.queryByText('think two')).toBeNull()
    fireEvent.click(screen.getByText('工作了 5 秒'))
    expect(screen.getByText(/运行了 1 个命令/)).toBeTruthy()
    // Expanding the group reveals the second stretch's folded thinking.
    fireEvent.click(screen.getByText(/运行了 1 个命令/))
    expect(screen.getByText('think two')).toBeTruthy()
  })

  it('reads a user-stopped turn as stopped-after instead of worked', () => {
    const turn = {
      turn: 1,
      start: { time: 1000 },
      end: { time: 44000 },
      status: 'closed',
      steps: [],
      data: { get: () => undefined },
    }
    const at = (key: string, kind: string, data: unknown) => chatNode(key, kind, data, { kind: 'turn', turn } as never)
    renderView([
      at('u1', 'user', {
        kind: 'user', seq: 1, time: 1,
        content: [{ type: 'text', text: 'go' }], source: null,
      }),
      at('a1', 'assistant-step', {
        status: 'interrupted', turn: 1, step: 1, time: 20000,
        blocks: [{ kind: 'reasoning', text: 'stopped think' }],
        finalNode: {
          kind: 'assistant', seq: 10, time: 20000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 1000, firstTokenTime: 1500, completedTime: 20000 },
        },
      }),
      at('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}', {
        isError: true, error: { name: 'Interrupted', code: 'interrupted' },
      }) }),
    ])
    // The user stopped the turn: the fold reads the stop, not "worked".
    expect(screen.getByText('用户 43 秒后停止')).toBeTruthy()
    expect(screen.queryByText(/工作了/)).toBeNull()
    // Expanding reveals the stopped turn's rows.
    fireEvent.click(screen.getByText('用户 43 秒后停止'))
    expect(screen.getByText(/运行了 1 个命令/)).toBeTruthy()
  })

  it('folds a running turn\'s context injections into one collapsed line', () => {
    const turn = {
      turn: 1,
      start: { time: 1000 },
      end: undefined,
      status: 'open',
      steps: [],
      data: { get: () => undefined },
    }
    const at = (key: string, kind: string, data: unknown) => chatNode(key, kind, data, { kind: 'turn', turn } as never)
    const context = (key: string, label: string, text: string) => at(key, 'context', {
      kind: 'context', seq: 5, time: 1500,
      content: [{ type: 'text', text }],
      source: { kind: 'file' }, provenance: { role: 'instructions', label }, form: null,
    })
    renderView([
      context('c1', 'AGENTS.md', 'rules text'),
      context('c2', '@deepseek-ai/dsh-system-prompt', 'prompt text'),
      context('c3', 'skill-catalog', 'catalog text'),
      at('a1', 'assistant-step', {
        status: 'running', turn: 1, step: 1, time: 2000,
        blocks: [{ kind: 'reasoning', text: 'thinking' }],
      }),
    ])
    // One collapsed line; the injections and their bodies stay hidden.
    expect(screen.getByText('上下文注入 · 3 项')).toBeTruthy()
    expect(screen.queryByText('AGENTS.md')).toBeNull()
    expect(screen.queryByText('rules text')).toBeNull()
    // Expanding reveals the individual context rows; each expands to its body.
    fireEvent.click(screen.getByText('上下文注入 · 3 项'))
    expect(screen.getByText('AGENTS.md')).toBeTruthy()
    expect(screen.queryByText('rules text')).toBeNull()
    fireEvent.click(screen.getByText('AGENTS.md'))
    expect(screen.getByText('rules text')).toBeTruthy()
  })

  it('absorbs a preceding context batch into the group summary line', () => {
    const turn = {
      turn: 1,
      start: { time: 1000 },
      end: undefined,
      status: 'open',
      steps: [],
      data: { get: () => undefined },
    }
    const at = (key: string, kind: string, data: unknown) => chatNode(key, kind, data, { kind: 'turn', turn } as never)
    const context = (key: string, label: string, text: string) => at(key, 'context', {
      kind: 'context', seq: 5, time: 1500,
      content: [{ type: 'text', text }],
      source: { kind: 'file' }, provenance: { role: 'instructions', label }, form: null,
    })
    renderView([
      context('c1', 'AGENTS.md', 'rules text'),
      context('c2', 'skill-catalog', 'catalog text'),
      at('a1', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 2000,
        blocks: [{ kind: 'reasoning', text: 'thinking' }],
        finalNode: {
          kind: 'assistant', seq: 10, time: 2000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 1000, firstTokenTime: 1500, completedTime: 2000 },
        },
      }),
      at('t1', 'tool-call', { root: settledCall('c1x', 'bash', '{}') }),
    ])
    // One summary line: the context batch folds into it, no separate row.
    expect(screen.getByText('思考了 0.5 秒，载入了 2 项上下文，运行了 1 个命令')).toBeTruthy()
    expect(screen.queryByText(/上下文注入/)).toBeNull()
    expect(screen.queryByText('AGENTS.md')).toBeNull()
    // Expanding reveals the absorbed rows inside the group: the context
    // rows first (session order), each expanding to its body.
    fireEvent.click(screen.getByText('思考了 0.5 秒，载入了 2 项上下文，运行了 1 个命令'))
    expect(screen.getByText('AGENTS.md')).toBeTruthy()
    fireEvent.click(screen.getByText('AGENTS.md'))
    expect(screen.getByText('rules text')).toBeTruthy()
  })

  it('keeps the running turn unfolded until it completes', () => {
    const turn = {
      turn: 1,
      start: { time: 1000 },
      end: undefined,
      status: 'open',
      steps: [],
      data: { get: () => undefined },
    }
    const at = (key: string, kind: string, data: unknown) => chatNode(key, kind, data, { kind: 'turn', turn } as never)
    renderView([
      at('a1', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 2000,
        blocks: [{ kind: 'reasoning', text: 'r1' }],
        finalNode: {
          kind: 'assistant', seq: 10, time: 2000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 1000, firstTokenTime: 1500, completedTime: 2000 },
        },
      }),
      at('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
    ])
    // No fold while the turn is open: the group line stays visible.
    expect(screen.getByText('思考了 0.5 秒，运行了 1 个命令')).toBeTruthy()
    expect(screen.queryByText(/工作了/)).toBeNull()
  })

  it('keeps runs separated by a user message as separate summary lines', () => {
    renderView([
      assistantNode('a1', 'settled', 't1', 3000),
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
      chatNode('u1', 'user', {
        kind: 'user', seq: 3, time: 3,
        content: [{ type: 'text', text: 'hello' }], source: null,
      }),
      assistantNode('a2', 'settled', 't2', 4000),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'bash', '{}') }),
    ])
    expect(screen.getAllByText(/运行了 1 个命令/).length).toBe(2)
  })

  it('renders a manual compaction with a checkpoint as the compact marker', () => {
    renderView([
      chatNode('manual', 'manual-compaction', {
        command: {
          kind: 'command', seq: 4, time: 4, commandId: 'cmd3', name: 'compact', args: '',
          outcome: { kind: 'success', text: 'done' },
        },
        compaction: {
          kind: 'compaction', seq: 5, time: 5, summary: 'sum', summaryEventSeq: 6,
          shadowedItemCount: 2, shadowedTokenCount: 3,
        },
      }),
    ])
    expect(screen.getByText('compact')).toBeTruthy()
    expect(screen.getByText('已压缩 2 条历史记录（约 3 tokens）')).toBeTruthy()
  })

  it('renders pending steering as a pre-admission bubble', () => {
    renderView([], {
      chat: chatOf([], {
        queue: [{
          id: 'q1' as never, messageId: 'm1' as never, placement: 'steering',
          content: [{ type: 'text', text: 'hold on' }], preview: 'hold on', text: 'hold on',
        }],
      }),
    })
    expect(screen.getByText('插话')).toBeTruthy()
    expect(screen.getByText('hold on')).toBeTruthy()
  })

  it('shows the history loading hint while the session opens', () => {
    renderView([], { chat: chatOf([], { openState: 'loading' }) })
    expect(screen.getByText('载入历史…')).toBeTruthy()
  })

  it('shows the floating back-to-bottom control once the reader scrolls up', () => {
    renderView([
      assistantNode('a1', 'settled', 't1', 3000),
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
    ])
    expect(screen.queryByRole('button', { name: '回到底部' })).toBeNull()
    const el = document.querySelector('[data-focus-scroll]') as HTMLElement
    Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true })
    el.scrollTop = 120
    fireEvent.scroll(el)
    expect(screen.getByRole('button', { name: '回到底部' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '回到底部' }))
    expect(el.scrollTop).toBe(500)
    expect(screen.queryByRole('button', { name: '回到底部' })).toBeNull()
  })

  it('threads file-mention vocabulary to the closing assistant prose only', () => {
    const fileMentions = vi.fn(() => undefined)
    const turn = {
      turn: 1,
      start: { time: 1000 },
      end: { time: 9000 },
      status: 'closed',
      steps: [],
      data: {
        get: (key: string) => key === 'turn-tail'
          ? {
            turn: 1, seq: 30, time: 9000,
            closing: { finalNode: { seq: 20, time: 8000 }, blocks: [], time: 8000 },
            branchUnavailable: false,
          }
          : undefined,
      },
    }
    renderView([
      chatNode('a1', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 8000,
        blocks: [{ kind: 'text', text: 'see `out/report.html`' }],
        finalNode: {
          kind: 'assistant', seq: 20, time: 8000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 6000, firstTokenTime: 7000, completedTime: 8000 },
        },
      }, { kind: 'turn', turn } as never),
      chatNode('a2', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 8000,
        blocks: [{ kind: 'text', text: 'not closing' }],
        finalNode: {
          kind: 'assistant', seq: 10, time: 8000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 6000, firstTokenTime: 7000, completedTime: 8000 },
        },
      }),
    ], { fileMentions: fileMentions as never })
    // Only the assistant whose final seq matches the turn tail's closing seq
    // receives the mention vocabulary.
    expect(fileMentions).toHaveBeenCalledTimes(1)
    expect(fileMentions).toHaveBeenCalledWith(expect.objectContaining({ seq: 20 }))
  })

  it('renders the turn tail: produced files and the copy/fork actions footer', () => {
    const forkAt = vi.fn()
    const openFile = vi.fn()
    const turn = {
      turn: 1,
      start: { time: 1000 },
      end: { time: 9000 },
      status: 'closed',
      steps: [],
      data: {
        get: (key: string) => key === 'deliverables'
          ? { produced: [{ seq: 15, path: 'out/report.html' }, { seq: 22, path: 'src/a.ts' }] }
          : undefined,
      },
    }
    renderView([
      chatNode('tail', 'turn-tail', {
        turn: 1, seq: 30, time: 9000,
        closing: {
          finalNode: { seq: 20, time: 8000 },
          blocks: [{ kind: 'text', text: 'done text' }],
          time: 8000,
        },
        branchUnavailable: false,
        ttftMs: 1200,
        tokensPerSecond: 34,
      }, { kind: 'turn', turn } as never),
    ], { openFile, forkAt })
    // The produced row lists only paths settled at or before the closing seq.
    expect(screen.getByText('产物')).toBeTruthy()
    expect(screen.getByText('report.html')).toBeTruthy()
    expect(screen.queryByText('a.ts')).toBeNull()
    // The actions footer: clock + turn readings (one clock span), copy, fork.
    expect(screen.getByText(/用时 8 秒/)).toBeTruthy()
    expect(screen.getByText(/首 token 1.2秒/)).toBeTruthy()
    expect(screen.getByText(/34 tok\/s/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '在新对话中分支' }))
    expect(forkAt).toHaveBeenCalledWith(20)
    // The produced chip opens through the host opener.
    fireEvent.click(screen.getByText('report.html'))
    expect(openFile).toHaveBeenCalledWith('out/report.html')
  })

  it('disables the fork action when the tail is not the turn last row', () => {
    const forkAt = vi.fn()
    const turn = {
      turn: 1,
      start: { time: 1000 },
      end: { time: 9000 },
      status: 'closed',
      steps: [],
      data: { get: () => undefined },
    }
    renderView([
      chatNode('tail', 'turn-tail', {
        turn: 1, seq: 30, time: 9000,
        closing: {
          finalNode: { seq: 20, time: 8000 },
          blocks: [{ kind: 'text', text: 'done text' }],
          time: 8000,
        },
        branchUnavailable: true,
      }, { kind: 'turn', turn } as never),
    ], { forkAt })
    const button = screen.getByRole('button', { name: '在新对话中分支' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(forkAt).not.toHaveBeenCalled()
  })

  it('renders produced files without the actions footer when the turn has no closing assistant', () => {
    const turn = {
      turn: 1,
      start: { time: 1000 },
      end: { time: 9000 },
      status: 'closed',
      steps: [],
      data: {
        get: (key: string) => key === 'deliverables'
          ? { produced: [{ seq: 5, path: 'out/report.html' }] }
          : undefined,
      },
    }
    renderView([
      chatNode('tail', 'turn-tail', {
        turn: 1, seq: 30, time: 9000,
        closing: null,
        branchUnavailable: true,
      }, { kind: 'turn', turn } as never),
    ])
    expect(screen.getByText('report.html')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '复制' })).toBeNull()
  })

  it('saves the reader position on scroll and restores it on remount', () => {
    const ledger: { position: FocusScrollPosition | null } = { position: null }
    const scroll = {
      save: (position: FocusScrollPosition | null) => { ledger.position = position },
      read: () => ledger.position,
    }
    const nodes = [
      assistantNode('a1', 'settled', 't1', 3000),
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
    ]
    renderView(nodes, { scroll, chat: chatOf(nodes, { openState: 'open' }) })
    const el = document.querySelector('[data-focus-scroll]') as HTMLElement
    // jsdom does not lay out: fake the geometry the at-bottom detection reads.
    Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true })
    el.scrollTop = 120
    fireEvent.scroll(el)
    expect(ledger.position).not.toBeNull()
    expect(ledger.position?.scrollTop).toBe(120)
    // The reasoning shell was absorbed into the group: the group's first
    // node key is the flow's leading anchor.
    expect(ledger.position?.anchorKey).toBe('t1')
    cleanup()
    renderView(nodes, { scroll, chat: chatOf(nodes, { openState: 'open' }) })
    expect((document.querySelector('[data-focus-scroll]') as HTMLElement).scrollTop).toBe(120)
  })

  it('expands a Think row into its reasoning body', () => {
    renderView([
      assistantNode('a1', 'settled', 'first line\nsecond line', 1500),
    ])
    // Collapsed: only the first line summary is visible.
    expect(screen.getByText('first line')).toBeTruthy()
    expect(screen.queryByText(/second line/)).toBeNull()
    fireEvent.click(screen.getByText('思考了 1.3 秒'))
    expect(screen.getByText(/second line/)).toBeTruthy()
  })

  it('shows the interrupted marker on a frozen partial and degrades unknown blocks to JSON', () => {
    renderView([
      chatNode('a1', 'assistant-step', {
        status: 'interrupted', turn: 1, step: 1, time: 100, blocks: [
          { kind: 'other', block: { opaque: 1 } },
        ],
      }),
    ])
    expect(screen.getByText('已停止')).toBeTruthy()
    expect(screen.getByRole('button', { name: /输出/ })).toBeTruthy()
  })

  it('renders the terminal card and the recursive sub-call tree in an expanded call', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{"command":"pnpm build"}', {
        callView: { card: 'terminal', title: 'pnpm build', cwd: '/ws' },
        resultView: { card: 'terminal', output: 'built ok', exitCode: 0 },
        subCalls: [settledCall('sub1', 'glob', '{"pattern":"src/**"}', {
          resultView: { card: 'search', shape: 'paths', paths: ['src/a.ts'], truncated: false, total: 1 },
        })],
      }) }),
    ])
    fireEvent.click(screen.getByText('运行了 1 个命令'))
    fireEvent.click(screen.getByText('Bash'))
    // The terminal card draws the command output; the sub-call row appears nested.
    expect(screen.getByText('built ok')).toBeTruthy()
    fireEvent.click(screen.getByText('Search'))
    expect(screen.getByText('src/a.ts')).toBeTruthy()
  })

  it('renders the read card for a completed read call', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'read', '{"path":"/ws/a.ts"}', {
        resultView: {
          card: 'read', path: '/ws/a.ts', offset: 1,
          lines: [{ number: 1, text: 'export const x = 1' }], totalLines: 3, lang: 'ts',
        },
      }) }),
    ], { cwd: '/ws' })
    fireEvent.click(screen.getByText('读取了 1 个文件'))
    fireEvent.click(screen.getByText('Read'))
    // The ReadBlock banner proves the full card renders with the windowed lines.
    expect(screen.getByText('显示 1 / 3 行')).toBeTruthy()
  })

  it('renders the diff and web cards for their calls', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'edit', '{}', {
        callView: { card: 'diff', title: 'Edit a.ts', diffs: [{ path: 'a.ts', oldText: 'old', newText: 'new' }] },
        resultView: { card: 'diff', diffs: [{ path: 'a.ts', oldText: 'old', newText: 'new' }] },
      }) }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'web_search', '{}', {
        resultView: { card: 'web', kind: 'search', sources: [{ url: 'https://dsh.dev', title: 'DSH' }], truncated: false },
      }) }),
    ])
    fireEvent.click(screen.getByText('编辑了 1 次，搜索了 1 次'))
    fireEvent.click(screen.getByText('Edit'))
    expect(screen.getByText('a.ts')).toBeTruthy()
    fireEvent.click(screen.getByText('Search'))
    expect(screen.getByText('DSH')).toBeTruthy()
  })

  it('renders running and outcome-less command rows and a bare compaction marker', () => {
    renderView([
      chatNode('run', 'command', {
        kind: 'command', seq: 1, time: 1, commandId: 'cmd1', name: 'plan', args: '',
        outcome: null,
      }),
      chatNode('done', 'command', {
        kind: 'command', seq: 2, time: 2, commandId: 'cmd2', name: 'tidy', args: '',
        outcome: { kind: 'success' },
      }),
      chatNode('nameless', 'command', {
        kind: 'command', seq: 5, time: 5, commandId: 'cmd4', name: null, args: null,
        outcome: { kind: 'success', text: 'no name' },
      }),
      chatNode('comp', 'compaction', {
        kind: 'compaction', seq: 3, time: 3, summary: null, summaryEventSeq: null,
        shadowedItemCount: null, shadowedTokenCount: null,
      }),
      chatNode('manual', 'manual-compaction', {
        command: { kind: 'command', seq: 4, time: 4, commandId: 'cmd3', name: null, args: '', outcome: null },
        compaction: null,
      }),
    ])
    expect(screen.getByText('plan')).toBeTruthy()
    expect(screen.getByText('执行中…')).toBeTruthy()
    expect(screen.getByText('tidy')).toBeTruthy()
    expect(screen.getByText('已完成')).toBeTruthy()
    // The nameless command and the running manual compaction share the fallback title.
    expect(screen.getAllByText('命令').length).toBe(2)
    expect(screen.getByText('no name')).toBeTruthy()
    expect(screen.getByText('正在压缩…')).toBeTruthy()
    expect(screen.getByText('上下文已压缩')).toBeTruthy()
    expect(screen.getByText('压缩摘要不可用')).toBeTruthy()
  })

  it('bounds oversized JSON payloads with the truncation footer', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}', {
        content: [{ type: 'tool-result', toolCallId: 'tc1' as never, content: [{ type: 'text', text: 'y'.repeat(21_000) }] }],
      }) }),
    ])
    fireEvent.click(screen.getByText('运行了 1 个命令'))
    fireEvent.click(screen.getByText('Bash'))
    // Non-text result blocks join the flattened OUT text as pretty JSON.
    expect(screen.getByText(/tool-result/)).toBeTruthy()
  })

  it('offers the load-older pager while more history exists', () => {
    const loadOlder = vi.fn()
    const { source } = renderView([], {
      loadOlder,
      chat: chatOf([], { hasMore: true }),
    })
    fireEvent.click(screen.getByText('加载更早的消息'))
    expect(loadOlder).toHaveBeenCalledTimes(1)
    act(() => {
      source.set(chatOf([], { hasMore: true, loadingOlder: true }))
    })
    expect(screen.getByText('加载中…')).toBeTruthy()
    expect(screen.getByRole('button', { name: /加载中/ })).toHaveProperty('disabled', true)
  })

  it('shows the Deep diving running signal with an elapsed clock past 15s', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const { source } = renderView([assistantNode('a1', 'running', 'streaming', 100)])
    act(() => {
      source.set(chatOf([assistantNode('a1', 'running', 'streaming', 100)], { running: true }))
    })
    expect(screen.getByText('Deep diving...')).toBeTruthy()
    // Under 15s: no clock yet.
    expect(screen.queryByText('16 秒')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(16_000)
    })
    expect(screen.getByText('16 秒')).toBeTruthy()
  })
})

describe('plugin apply', () => {
  it('registers the focus tab on a real slot ring and disposes with the fiber', async () => {
    const { Context } = await import('cordis')
    const { SlotsService } = await import('@deepseek-ai/dsh-client-runtime/client')
    const { apply, inject } = await import('../src/client/index.ts')
    const ctx = new Context()
    const slots = new SlotsService(ctx)
    slots.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    }, (_p: { renderSlot?: unknown }) => null)
    ctx.provide('locale', {
      register: () => {},
      bind: () => () => 'Focus chat',
    })
    ctx.provide('sessions', { scope: () => undefined })
    ctx.provide('workspaces', { openPath: async () => {} })
    const fiber = ctx.plugin({ apply, inject })
    await fiber.await()
    const entries = slots.entries('conversation.view')
    expect(entries.map(entry => entry.options.id)).toContain('focus')
    // The tab label reads through the bound translate thunk.
    const focus = entries.find(entry => entry.options.id === 'focus')
    expect(focus !== undefined && resolveSlotLabel(focus.options.label)).toBe('Focus chat')
    await fiber.dispose()
    expect(slots.entries('conversation.view')).toHaveLength(0)
  })

  it('keeps the host half a no-op apply', async () => {
    const { apply: nodeApply } = await import('../src/index.ts')
    expect(() => { nodeApply() }).not.toThrow()
  })
})
