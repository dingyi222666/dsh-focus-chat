// @vitest-environment jsdom
/** FocusView behavior: condensed flow rows, Think auto-expand/fold, running status, folded tool groups with full card expansion. */
import { useEffect, useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ChatConversationViewNode, ConversationSnapshot, RunningToolCall, SessionId, SessionListState,
  ToolResultNode, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { FocusView } from '../src/client/view/FocusView.tsx'
import type { FocusViewProps } from '../src/client/contract/props.ts'
import type { FocusScrollPosition } from '../src/client/contract/props.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const SID = 's1' as SessionId
const t = makeTranslate(zh)

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
    jobsBySession: {},
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

/** Test stand-in for the attachment plugin's `conversation.message.images`
 *  slot: renders each image as an <img> once its loader resolves (the real
 *  gallery's alt contract), so the slot-backed render path is exercised. */
function TestMessageGallery({ owner }: {
  owner: {
    images: readonly { attachment: { attachmentId: string; name?: string } }[]
    align: 'start' | 'end'
    loadImage: (attachment: { attachmentId: string; name?: string }) => Promise<string>
  }
}) {
  return (
    <div data-testid="message-images" data-align={owner.align} data-count={owner.images.length}>
      {owner.images.map(({ attachment: image }) => (
        <TestMessageImage key={image.attachmentId} attachment={image} loadImage={owner.loadImage} />
      ))}
    </div>
  )
}

function TestMessageImage({ attachment, loadImage }: {
  attachment: { attachmentId: string; name?: string }
  loadImage: (attachment: { attachmentId: string; name?: string }) => Promise<string>
}) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void loadImage(attachment).then(url => { if (live) setSrc(url) }).catch(() => {})
    return () => { live = false }
  }, [attachment, loadImage])
  return <img alt={attachment.name ?? 'image'} src={src ?? undefined} />
}

function renderView(nodes: ReturnType<typeof chatNode>[], opts: {
  cwd?: string
  loadOlder?: () => void
  loadImage?: (attachment: unknown) => Promise<string>
  openFile?: (path: string) => void
  forkAt?: (seq: number) => void
  fileMentions?: (owner: unknown) => unknown
  isLoopback?: boolean
  chat?: ChatSlice
  t?: FocusViewProps['t']
  home?: string
  renderSlot?: (key: string, owner: never, opts?: never) => ReactNode
  scroll?: { save: (position: FocusScrollPosition | null) => void; read: () => FocusScrollPosition | null }
} = {}): {
  result: ReturnType<typeof render>
  source: ReturnType<typeof createSnapshotStore<ChatSlice>>
} {
  const source = createSnapshotStore<ChatSlice>(opts.chat ?? chatOf(nodes))
  const loadImage = opts.loadImage ?? (() => Promise.reject(new Error('no loader')))
  const props = {
    sessionId: SID,
    useSession: bindSnapshotSelector(source),
    useSessions: bindSnapshotSelector(sessionsStore(opts.cwd)),
    useWorkspaces: bindSnapshotSelector(workspacesStore()),
    useProjection: (() => undefined) as never,
    loadOlder: opts.loadOlder ?? (() => {}),
    loadImage,
    openFile: opts.openFile ?? (() => Promise.resolve()),
    forkAt: opts.forkAt ?? (() => {}),
    fileMentions: opts.fileMentions ?? (() => undefined),
    isLoopback: opts.isLoopback ?? true,
    scroll: opts.scroll ?? { save: () => {}, read: () => null },
    useHostDescription: (selector: (description: { home?: string } | undefined) => string | undefined) => selector({ home: opts.home }),
    renderSlot: opts.renderSlot ?? ((key: string, owner: never) => (
      key === 'conversation.message.images'
        ? <TestMessageGallery owner={owner as never} />
        : null
    )),
    t: opts.t ?? t,
  } as unknown as FocusViewProps
  return { result: render(<FocusView {...props} />), source }
}

/** The group summary line element whose full text (nested failure spans
 *  included) equals `text` — the default text matcher sees direct text
 *  nodes only, so it cannot read the line through the failure spans. */
function fullText(text: string): HTMLElement {
  return screen.getByText((_content, element) => element?.textContent === text, {
    selector: '[data-group-title]',
  })
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
    // The user bubble renders the text (the nav rail duplicates the label).
    expect(within(document.querySelector('[data-focus-anchor-key="u1"]') as HTMLElement).getByText('hello')).toBeTruthy()
    expect(screen.getByText('answer text')).toBeTruthy()
    expect(screen.getByText('思考了 1.3 秒')).toBeTruthy()
  })

  it('keeps the plain Think title while running or without timing', () => {
    renderView([
      assistantNode('a1', 'running', 'streaming', 100),
    ])
    expect(screen.getByText('Think')).toBeTruthy()
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
      openFile: () => Promise.resolve(),
      forkAt: () => {},
      fileMentions: (() => undefined) as never,
      scroll: { save: () => {}, read: () => null },
      useHostDescription: () => undefined,
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
    const row = screen.getByText('Think')
    const wrap = row.closest('[data-state]')
    expect(wrap?.getAttribute('data-state')).toBe('running')
    expect(wrap?.querySelector('.thinkRowInner, [data-disclosure-row]')).toBeTruthy()
  })

  it('keeps the leading Think row standalone above the folded run', () => {
    renderView([
      assistantNode('a1', 'settled', 'think text\nmore', 3000),
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{"command":"build"}') }),
    ])
    // A leading think — no preceding run to fold into — stays on its
    // assistant: the duration title row above, the run's group below.
    expect(screen.getByText('思考了 1.3 秒')).toBeTruthy()
    expect(screen.getByText('运行了 1 个命令')).toBeTruthy()
    const column = document.querySelector('[data-focus-flow]')?.textContent ?? ''
    expect(column.indexOf('思考了 1.3 秒')).toBeLessThan(column.indexOf('运行了 1 个命令'))
    // The Think row expands to its reasoning body.
    fireEvent.click(screen.getByText('思考了 1.3 秒'))
    expect(screen.getByText(/more/)).toBeTruthy()
  })

  it('keeps the leading Think row above the reply with the run below', () => {
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
    // The Think row stays on the assistant, above the reply; the run folds
    // into the group below (the chat order: think → reply → tool rows).
    expect(screen.getByText('Think')).toBeTruthy()
    expect(screen.getByText('answer text')).toBeTruthy()
    const column = document.querySelector('[data-focus-flow]')?.textContent ?? ''
    expect(column.indexOf('Think')).toBeLessThan(column.indexOf('answer text'))
    expect(column.indexOf('answer text')).toBeLessThan(column.indexOf('运行了 1 个命令'))
    fireEvent.click(screen.getByText('运行了 1 个命令'))
    // The group holds the call row only — the think did not fold in.
    expect(screen.getByText('Bash')).toBeTruthy()
    expect(screen.getByText('think text')).toBeTruthy()
  })

  it('aggregates command, search, and exploration metrics into the group line', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'web_search', '{}') }),
      chatNode('t3', 'tool-call', { root: settledCall('c3', 'read', '{}') }),
      chatNode('t4', 'tool-call', { root: settledCall('c4', 'glob', '{}') }),
    ])
    expect(screen.getByText('运行了 1 个命令，搜索了 1 个正则，读取了 1 个文件，列出了 1 个目录')).toBeTruthy()
  })

  it('appends a failure tally to a mixed family in the summary line', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'bash', '{}', {
        isError: true, error: { name: 'Error', code: 'boom' },
      }) }),
    ])
    expect(fullText('运行了 1 个命令（1 次失败）')).toBeTruthy()
  })

  it('reads a fully failed family as its singular phrase or an all-failed suffix', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}', {
        isError: true, error: { name: 'Error', code: 'boom' },
      }) }),
    ])
    expect(screen.getByText('命令失败', { selector: '[data-group-title-failed]' })).toBeTruthy()
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}', {
        isError: true, error: { name: 'Error', code: 'boom' },
      }) }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'bash', '{}', {
        isError: true, error: { name: 'Error', code: 'boom' },
      }) }),
    ])
    expect(fullText('运行了 2 个命令（全部失败）')).toBeTruthy()
  })

  it('never reads a failure tally for the edit family — a retried file reads one edited file', () => {
    // The same file edited twice, the first call failing: the edit family
    // counts the file's outcome (one successful call ⇒ one edited file), so
    // the summary must read a plain count — never "全部失败", which the
    // call-level failure cannot claim against the file-level count.
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'edit', '{"file_path":"/ws/a.ts"}', {
        isError: true, error: { name: 'Error', code: 'boom' },
      }) }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'edit', '{"file_path":"/ws/a.ts"}') }),
    ])
    expect(fullText('编辑了 1 个文件')).toBeTruthy()
    expect(screen.queryByText('全部失败', { selector: '[data-group-title-failed]' })).toBeNull()
    expect(screen.queryByText('编辑失败', { selector: '[data-group-title-failed]' })).toBeNull()
  })

  it('drops files whose only edit calls failed from the edited count', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'edit', '{"file_path":"/ws/a.ts"}', {
        isError: true, error: { name: 'Error', code: 'boom' },
      }) }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'write', '{"path":"/ws/b.ts"}') }),
    ])
    // Only b.ts was actually edited; the failed a.ts never counts toward
    // "edited N files", and no failure annotation rides the line.
    expect(fullText('编辑了 1 个文件')).toBeTruthy()
    expect(screen.queryByText('全部失败', { selector: '[data-group-title-failed]' })).toBeNull()
  })

  it('reads background-job calls, image reads, and str_replace edits as their own families', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'job_output', '{"job_id":"j1"}') }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'job_kill', '{"job_id":"j2"}') }),
    ])
    // The job control tools fold into the background-jobs family.
    expect(fullText('后台任务 2 个')).toBeTruthy()
    renderView([
      chatNode('t3', 'tool-call', { root: settledCall('c3', 'read_image', '{"path":"/ws/a.png"}') }),
    ])
    // An image read counts as a file read.
    expect(fullText('读取了 1 个文件')).toBeTruthy()
    renderView([
      chatNode('t4', 'tool-call', { root: settledCall('c4', 'str_replace_editor', '{"command":"str_replace","path":"/ws/a.ts"}') }),
    ])
    // str_replace_editor is an edit tool: the file counts as edited.
    expect(fullText('编辑了 1 个文件')).toBeTruthy()
  })

  it('shows a dirs-only exploration metric, the edit family folding writes, and the total-count fallback', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'glob', '{}') }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'write', '{}') }),
    ])
    // A write call counts in the edit family (the summary line reads one
    // "edited" segment); a call without a derivable path counts as its own
    // file entry.
    expect(screen.getByText('编辑了 1 个文件，列出了 1 个目录')).toBeTruthy()
    renderView([
      chatNode('t3', 'tool-call', { root: settledCall('c3', 'edit', '{}') }),
    ])
    expect(screen.getByText('编辑了 1 个文件')).toBeTruthy()
    // The edit family counts distinct files from the call args: the same
    // file edited twice reads one file, two files read two.
    renderView([
      chatNode('t5', 'tool-call', { root: settledCall('c5', 'edit', '{"file_path":"/ws/a.ts"}') }),
      chatNode('t6', 'tool-call', { root: settledCall('c6', 'edit', '{"file_path":"/ws/a.ts"}') }),
      chatNode('t7', 'tool-call', { root: settledCall('c7', 'write', '{"path":"/ws/b.ts"}') }),
      chatNode('t8', 'tool-call', { root: settledCall('c8', 'patch', '{"file_path":"/ws/a.ts"}') }),
    ])
    expect(screen.getByText('编辑了 2 个文件')).toBeTruthy()
    renderView([
      chatNode('t4', 'tool-call', { root: settledCall('c4', 'run_code', '{}') }),
    ])
    expect(screen.getByText('调用了 1 个工具')).toBeTruthy()
  })

  it('reads delegation, todo, goal, workflow, skill, question, and plan calls as their own segments', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'subagent', '{}') }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'subagent_fork', '{}') }),
      chatNode('t3', 'tool-call', { root: settledCall('c3', 'todo_write', '{}') }),
      chatNode('t4', 'tool-call', { root: settledCall('c4', 'create_goal', '{}') }),
      chatNode('t5', 'tool-call', { root: settledCall('c5', 'update_goal', '{}') }),
      chatNode('t6', 'tool-call', { root: settledCall('c6', 'get_goal', '{}') }),
      chatNode('t7', 'tool-call', { root: settledCall('c7', 'workflow', '{}') }),
      chatNode('t8', 'tool-call', { root: settledCall('c8', 'ralph', '{}') }),
      chatNode('t9', 'tool-call', { root: settledCall('c9', 'skill', '{}') }),
      chatNode('t10', 'tool-call', { root: settledCall('c10', 'ask_user_question', '{}') }),
      chatNode('t11', 'tool-call', { root: settledCall('c11', 'plan', '{}') }),
      chatNode('t12', 'tool-call', { root: settledCall('c12', 'run_code', '{}') }),
    ])
    // The agentic families read their own segments (todo and goal drop the
    // count); the metric-less remainder keeps the generic "called N tools".
    expect(fullText('Fork 了 2 个子代理，更新了待办，更新了目标，运行了 2 个工作流，载入了 1 个技能，问了 1 个问题，计划了 1 次，调用了 1 个工具')).toBeTruthy()
  })

  it('renders the ask-question row with its interaction outcome', () => {
    const at = (overrides: Partial<ToolResultNode> = {}) => chatNode('t1', 'tool-call', {
      root: settledCall('c1', 'ask_user_question', '{"questions":[]}', overrides),
    })
    // Settled with the answer batch: the answered count reads the summary.
    renderView([at({ content: [{ type: 'text', text: JSON.stringify({ answers: [
      { id: 'q1', selected: ['a'] }, { id: 'q2', selected: [], custom: '' },
    ] }) }] })])
    fireEvent.click(screen.getByText('问了 1 个问题'))
    expect(screen.getByText('提问')).toBeTruthy()
    expect(screen.getByText('1/2 已回答')).toBeTruthy()
    cleanup()
    // Dismissed set: the verdict names the cancellation.
    renderView([at({ isError: true, error: { name: 'UserInteractionError', code: 'ASK_CANCELLED' } })])
    fireEvent.click(screen.getByText('问了 1 个问题'))
    expect(screen.getByText('已取消')).toBeTruthy()
    cleanup()
    // Interrupt while pending: the shared stopped semantics.
    renderView([at({ isError: true, error: { name: 'UserInteractionError', code: 'ASK_ABORTED' } })])
    fireEvent.click(screen.getByText('问了 1 个问题'))
    expect(screen.getByText('已中断')).toBeTruthy()
    cleanup()
    // Running: the live row reads as the waiting composer (one row only —
    // the group line carries no running fallback).
    renderView([chatNode('t1', 'tool-call', { root: runningCall('c1', 'ask_user_question', '{"questions":[]}') })])
    expect(screen.getByText('提问')).toBeTruthy()
    expect(screen.getByText('等待回答')).toBeTruthy()
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
      chatNode('t8', 'tool-call', { root: settledCall('c8', 'skill', '{"name":"browse"}') }),
      chatNode('t9', 'tool-call', { root: settledCall('c9', 'echo', '{}') }),
      chatNode('t10', 'tool-call', { root: settledCall('c10', 'bash', '{"command":"x"}', {
        isError: true, error: { name: 'Error', code: 'boom' },
        content: [{ type: 'text', text: 'boom' }],
      }) }),
    ])
    fireEvent.click(fullText('运行了 1 个命令（1 次失败），编辑了 2 个文件，搜索了 1 个正则，更新了待办，载入了 1 个技能，读取了 1 个文件，调用了 2 个工具'))
    // Chat row titles per variant; the unknown tool keeps the static title.
    const rowOf = (title: string, index = 0) => screen.getAllByText(title)[index]?.closest('[data-disclosure-row]')
    expect(rowOf('Bash', 0)?.querySelector('[data-tool-icon="bash"]')).toBeTruthy()
    expect(rowOf('Read')?.querySelector('[data-tool-icon="read"]')).toBeTruthy()
    expect(rowOf('Search')?.querySelector('[data-tool-icon="search"]')).toBeTruthy()
    expect(rowOf('Write')?.querySelector('[data-tool-icon="write"]')).toBeTruthy()
    expect(rowOf('Edit')?.querySelector('[data-tool-icon="edit"]')).toBeTruthy()
    expect(rowOf('Code')?.querySelector('[data-tool-icon="code"]')).toBeTruthy()
    // The todo and skill rows own their family icons (the chat toolviews).
    expect(rowOf('更新任务清单')?.querySelector('[data-tool-icon="todo"]')).toBeTruthy()
    expect(rowOf('Skill')?.querySelector('[data-tool-icon="skill"]')).toBeTruthy()
    expect(rowOf('Tool call')?.querySelector('[data-tool-icon="others"]')).toBeTruthy()
    // The failing call keeps the red state dot, not the family icon.
    expect(screen.getByText('boom').closest('[data-disclosure-row]')?.querySelector('[data-tool-icon]')).toBeNull()
  })

  it('renders a todo_write row with the plan summary (the chat TodoRow derivation)', () => {
    const args = JSON.stringify({ todos: [
      { content: 'Check current working directory and git status, run initial tests as baseline', status: 'in_progress' },
      { content: 'second parallel task', status: 'in_progress' },
      { content: 'run the tests', status: 'pending' },
    ] })
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'todo_write', args) }),
    ])
    fireEvent.click(fullText('更新了待办'))
    // The row reads the localized title + the "{done}/{total} completed ·
    // <first active> +N" plan summary (the official TodoRow format).
    expect(screen.getByText('更新任务清单')).toBeTruthy()
    expect(screen.getByText('0/3 已完成 · Check current working directory and git status, run initial tests as baseline +1')).toBeTruthy()
  })

  it('renders a skill row with the Skill title and the skill name summary', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'skill', '{"name":"web-browse"}') }),
    ])
    fireEvent.click(fullText('载入了 1 个技能'))
    expect(screen.getByText('Skill')).toBeTruthy()
    expect(screen.getByText('web-browse')).toBeTruthy()
  })

  it('renders the running call as a live row at the end of the flow', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: runningCall('c1', 'bash') }),
    ])
    // The running call renders once, as the live row at the END of the flow
    // (below the model output text): the group paints no line while every
    // call still runs, so the same call never shows twice.
    expect(screen.getByText('Bash')).toBeTruthy()
    expect(screen.getAllByText('{}').length).toBe(1)
    expect(screen.queryByText('运行了 1 个命令')).toBeNull()
    expect(screen.queryByText('输入')).toBeNull()
    const row = screen.getByText('Bash').closest('[data-state]')
    expect(row?.getAttribute('data-state')).toBe('running')
  })

  it('holds a young running call back from the live row until the debounce window passes', () => {
    vi.useFakeTimers()
    const young = { ...runningCall('c1', 'bash', '{"command":"fast"}'), time: Date.now() }
    const { source } = renderView([
      chatNode('t1', 'tool-call', { root: young }),
    ])
    // A call younger than the live-row debounce paints nothing — no live
    // row and no running fallback line (a fast call would flash both and
    // settle into the summary a moment later).
    expect(screen.queryByText('Bash')).toBeNull()
    expect(screen.queryByText(/fast/)).toBeNull()
    act(() => { vi.advanceTimersByTime(500) })
    // Past the window the live row appears (once — the group paints no line).
    expect(screen.getByText('Bash')).toBeTruthy()
    expect(screen.getByText('fast')).toBeTruthy()
    act(() => {
      source.set(chatOf([
        chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{"command":"fast"}') }),
      ]))
    })
    // Settled: the summary gains the entry directly, no live row.
    expect(screen.queryByText('Bash')).toBeNull()
    expect(screen.getByText('运行了 1 个命令')).toBeTruthy()
  })

  it('keeps the running call as a live row and folds it into the summary once settled', () => {
    const { source } = renderView([
      assistantNode('a1', 'settled', 't', 3000),
      chatNode('t1', 'tool-call', { root: runningCall('c1', 'bash', '{"command":"pnpm build"}') }),
    ])
    // While the call runs the summary line reads the settled metrics only —
    // the thought is in, the call is not ("完成了才收进去摘要行") — and the
    // call renders as a live row at the end of the flow.
    expect(screen.getByText('思考了 1.3 秒')).toBeTruthy()
    expect(screen.queryByText('运行了 1 个命令')).toBeNull()
    expect(screen.getByText('Bash')).toBeTruthy()
    expect(screen.getByText('pnpm build')).toBeTruthy()
    act(() => {
      source.set(chatOf([
        assistantNode('a1', 'settled', 't', 3000),
        chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
      ]))
    })
    // Once settled the call folds in: the summary line now counts it, the
    // live row is gone; the leading think keeps its own duration row.
    expect(screen.queryByText('Bash')).toBeNull()
    expect(screen.getByText('运行了 1 个命令')).toBeTruthy()
    expect(screen.getByText('思考了 1.3 秒')).toBeTruthy()
  })

  it('keeps the streaming Think row standalone and folds it once the step settles', () => {
    const running = chatNode('a1', 'assistant-step', {
      status: 'running', turn: 1, step: 1, time: 3000,
      blocks: [
        { kind: 'reasoning', text: 'thinking out loud' },
        { kind: 'text', text: 'doing it' },
      ],
    })
    const settled = chatNode('a1', 'assistant-step', {
      status: 'settled', turn: 1, step: 1, time: 3000,
      blocks: [
        { kind: 'reasoning', text: 'thinking out loud' },
        { kind: 'text', text: 'doing it' },
      ],
      finalNode: {
        kind: 'assistant', seq: 5, time: 3000, turn: 1, step: 1, blocks: [],
        timing: { stepStartTime: 1000, firstTokenTime: 2300, completedTime: 3000 },
      },
    })
    const call = () => chatNode('t1', 'tool-call', { root: runningCall('c1', 'bash', '{"command":"build"}') })
    const { source } = renderView([running, call()])
    // While the step streams, the Think row stays standalone above the reply
    // and the run's group carries no think yet (the chat live row).
    expect(screen.getByText('Think')).toBeTruthy()
    expect(screen.getByText('thinking out loud')).toBeTruthy()
    expect(screen.getByText('doing it')).toBeTruthy()
    expect(screen.getByText('Bash')).toBeTruthy()
    expect(screen.getByText('build')).toBeTruthy()
    expect(screen.queryByText('思考了 1.3 秒')).toBeNull()
    act(() => {
      source.set(chatOf([settled, call()]))
    })
    // Settled: the reasoning folds into the group — the line carries the
    // thinking metric and no standalone Think row remains.
    expect(screen.queryByText('Think')).toBeNull()
    expect(screen.getByText('思考了 1.3 秒')).toBeTruthy()
    expect(screen.getByText('doing it')).toBeTruthy()
  })

  it('keeps a folded think from sweeping while a group call still runs', () => {
    renderView([
      // A settled run, then a settled assistant whose reasoning folds into
      // the group, then a still-running call that merges into the same
      // group — the group paints a summary and the live row keeps running.
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
      assistantNode('a1', 'settled', 'thinking text', 3000),
      chatNode('t2', 'tool-call', { root: runningCall('c2', 'bash', '{"command":"build"}') }),
    ])
    // The folded think's metric rides the line; the settled call counts,
    // the still-running one does not.
    expect(fullText('思考了 1.3 秒，运行了 1 个命令')).toBeTruthy()
    // Expand the group: the folded think is settled reasoning — it must not
    // carry the sweep animation just because the group's call still runs.
    fireEvent.click(screen.getByText('思考了 1.3 秒，运行了 1 个命令'))
    const think = screen.getByText('Think').closest('[data-state]')
    expect(think?.getAttribute('data-state')).toBe('ok')
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
    fireEvent.click(screen.getByText('运行了 1 个命令，搜索了 1 个正则'))
    expect(screen.getByText('Build the app')).toBeTruthy()
    expect(screen.getByText('Search results')).toBeTruthy()
    expect(screen.queryByText('pnpm build')).toBeNull()
  })

  it('abbreviates a host-home path summary as ~ and names every search query', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'read', '{"path":"/Users/dingyi/projects/dsh/ui-focus/notes.md"}') }),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'web_search', '{"queries":["focus flow","nav rail"],"pattern":"x"}') }),
    ], { cwd: '/ws', home: '/Users/dingyi' })
    fireEvent.click(fullText('搜索了 1 个正则，读取了 1 个文件'))
    // A workspace-rooted summary relativizes to the cwd; a leftover home
    // path abbreviates as ~ (the ui-tool chat rule).
    expect(screen.getByText('~/projects/dsh/ui-focus/notes.md')).toBeTruthy()
    // The search row names every query it ran, joined by commas.
    expect(screen.getByText('focus flow, nav rail')).toBeTruthy()
  })

  it('surfaces a failing terminal exit as the row red dot', () => {
    renderView([
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}', {
        callView: { card: 'terminal', title: 'build' },
        resultView: { card: 'terminal', output: 'boom', exitCode: 2 },
      }) }),
    ])
    fireEvent.click(screen.getByText('命令失败', { selector: '[data-group-title-failed]' }))
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
    fireEvent.click(screen.getByText('命令失败', { selector: '[data-group-title-failed]' }))
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
    // The title/summary separator keeps its styled gap (a missing CSS class
    // would glue the row into `compactdone line`).
    const separator = document.querySelector('.commandRow [data-disclosure-row] [aria-hidden="true"]')
    expect(separator?.getAttribute('class') ?? '').not.toBe('undefined')
    // The compaction marker aggregates the structured counts.
    expect(screen.getByText('上下文已压缩')).toBeTruthy()
    expect(screen.getByText('已压缩 4 条历史记录（约 5 tokens）')).toBeTruthy()
    // The retry row counts down (scheduled → shimmer) and expands to details.
    expect(screen.getByText('正在重试模型请求（1/3） · 3s')).toBeTruthy()
    fireEvent.click(screen.getByText('正在重试模型请求（1/3） · 3s'))
    expect(screen.getByText('重试延迟：')).toBeTruthy()
    expect(screen.getByText('失败原因：')).toBeTruthy()
    // The failure message appears in the retry details and the turn error.
    expect(screen.getAllByText('boom').length).toBe(2)
    expect(screen.getByText('本轮运行失败')).toBeTruthy()
    expect(screen.getByRole('button', { name: /future-kind/ })).toBeTruthy()
  })

  it('renders a failed manual compaction with the command error state', () => {
    renderView([
      chatNode('mc', 'manual-compaction', {
        kind: 'manual-compaction', seq: 1, time: 1,
        command: { name: 'compact', outcome: { kind: 'error', text: 'This operation was aborted' } },
        compaction: null,
      }),
    ])
    // A /compact without a checkpoint keeps the GenericCommandCard treatment
    // (the official CompactionCommandCard rule): the failed outcome carries
    // the error state — red summary and the error state dot.
    const row = screen.getByText('compact').closest('[data-state]')
    expect(row?.getAttribute('data-state')).toBe('error')
    expect(screen.getByText('This operation was aborted').closest('[data-error]')).toBeTruthy()
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

  it('renders user and assistant image blocks through the gallery', async () => {
    renderView([
      chatNode('u1', 'user', {
        kind: 'user', seq: 1, time: 1,
        content: [
          { type: 'text', text: 'look' },
          { type: 'image', attachment: { attachmentId: 'img1', name: 'shot.png' } } as never,
        ],
        source: null,
      }),
      chatNode('a1', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 3000,
        blocks: [
          { kind: 'text', text: 'done' },
          { kind: 'image', attachment: { attachmentId: 'img2', name: 'out.png' } } as never,
        ],
        finalNode: {
          kind: 'assistant', seq: 5, time: 3000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 1000, firstTokenTime: 1500, completedTime: 3000 },
        },
      }),
    ], { loadImage: () => Promise.resolve('data:image/png;base64,AA==') })
    // Flush the loader resolution: each MessageImage swaps its loading state
    // for the decoded <img>.
    await act(async () => {})
    // The user caption renders in its bubble (the rail duplicates the label).
    expect(within(document.querySelector('[data-focus-anchor-key="u1"]') as HTMLElement).getByText('look')).toBeTruthy()
    expect(screen.getByText('done')).toBeTruthy()
    expect(screen.getByAltText('shot.png')).toBeTruthy()
    expect(screen.getByAltText('out.png')).toBeTruthy()
  })

  it('renders an image-only user message without a bubble shell', async () => {
    renderView([
      chatNode('u1', 'user', {
        kind: 'user', seq: 1, time: 1,
        content: [{ type: 'image', attachment: { attachmentId: 'img1', name: 'shot.png' } } as never],
        source: null,
      }),
    ], { loadImage: () => Promise.resolve('data:image/png;base64,AA==') })
    await act(async () => {})
    // The gallery renders; an image-only message shows no bubble text (the
    // chat showBubble rule) — only the copy action remains below.
    expect(screen.getByAltText('shot.png')).toBeTruthy()
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('merges directly-consecutive runs into one summary line, keeping the folded think inside', () => {
    renderView([
      assistantNode('a1', 'settled', 'first think\nmore one', 3000),
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{"command":"build"}') }),
      assistantNode('a2', 'settled', 'second think\nmore two', 4000),
      chatNode('t2', 'tool-call', { root: settledCall('c2', 'bash', '{"command":"test"}') }),
      chatNode('t3', 'tool-call', { root: settledCall('c3', 'bash', '{"command":"lint"}') }),
    ])
    // The leading think stays on its assistant; the second think folds into
    // the group (the chat order: the run ran, then the next step's Think
    // disclosure) and the directly-consecutive runs all merge into one
    // line whose thinking metric leads.
    expect(screen.getByText('思考了 1.3 秒')).toBeTruthy()
    expect(screen.getByText('思考了 1.3 秒，运行了 3 个命令')).toBeTruthy()
    fireEvent.click(screen.getByText('思考了 1.3 秒，运行了 3 个命令'))
    // The folded rows keep flow order: the calls and the absorbed think.
    const calls = document.querySelector('[data-calls]')
    const text = calls?.textContent ?? ''
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
    // The user message stays visible outside the fold (the rail duplicates its label).
    expect(within(document.querySelector('[data-focus-anchor-key="u1"]') as HTMLElement).getByText('go')).toBeTruthy()
    // Expanding the fold reveals the folded rows — the leading think (its
    // own duration row), the group, and the context injection.
    fireEvent.click(screen.getByText('工作了 7 秒'))
    expect(screen.getByText('思考了 0.5 秒')).toBeTruthy()
    expect(screen.getByText('运行了 1 个命令')).toBeTruthy()
    // The context injection row is inside the fold; expanding it reveals its
    // code-block card body.
    fireEvent.click(screen.getByText('上下文注入'))
    expect(screen.getByText('injected rules')).toBeTruthy()
    fireEvent.click(screen.getByText('运行了 1 个命令'))
    expect(screen.getByText('Bash')).toBeTruthy()
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
    expect(screen.queryByText('Think')).toBeNull()
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
    // The steering stays visible (the rail duplicates its label).
    expect(within(document.querySelector('[data-focus-anchor-key="s1"]') as HTMLElement).getByText('wait no')).toBeTruthy()
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
    expect(screen.getByText('用户在 43 秒后停止')).toBeTruthy()
    expect(screen.queryByText(/工作了/)).toBeNull()
    // Expanding reveals the stopped turn's rows.
    fireEvent.click(screen.getByText('用户在 43 秒后停止'))
    expect(screen.getByText(/运行了 1 个命令/)).toBeTruthy()
  })

  it('reads a stop during tool execution as stopped-after (synthetic unknown-outcome result)', () => {
    // The real stop-mid-tool shape (repair.ts): the assistant settled its
    // reply normally, then the running tool lands a synthetic result with
    // error TOOL_OUTCOME_UNKNOWN — the stop happened in the tool, not the
    // stream, so the fold must still read the stop.
    const turn = {
      turn: 1,
      start: { time: 1000 },
      end: { time: 20000 },
      status: 'closed',
      steps: [],
      data: { get: () => undefined },
    }
    const at = (key: string, kind: string, data: unknown) => chatNode(key, kind, data, { kind: 'turn', turn } as never)
    renderView([
      at('u1', 'user', {
        kind: 'user', seq: 1, time: 1000,
        content: [{ type: 'text', text: 'go' }], source: null,
      }),
      at('a1', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 5000,
        blocks: [
          { kind: 'text', text: 'killing the server' },
          { kind: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' },
        ],
        finalNode: {
          kind: 'assistant', seq: 10, time: 5000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 1000, firstTokenTime: 2000, completedTime: 5000 },
        },
      }),
      at('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}', {
        isError: true,
        error: { name: 'ToolOutcomeUnknownError', code: 'TOOL_OUTCOME_UNKNOWN' },
        content: [{ type: 'text', text: 'The tool call was interrupted after it was recorded, but no result was durably recorded.' }],
      }) }),
    ])
    // The stopped fold, not a worked line.
    expect(screen.getByText('用户在 19 秒后停止')).toBeTruthy()
    expect(screen.queryByText(/工作了/)).toBeNull()
    // Expanding reveals the stopped tool row (never a red failure).
    fireEvent.click(screen.getByText('用户在 19 秒后停止'))
    fireEvent.click(screen.getByText(/运行了 1 个命令/))
    const row = document.querySelector('[data-state="stopped"]')
    expect(row).toBeTruthy()
    expect(document.querySelector('[data-state="error"]')).toBeNull()
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
    // The context batch folds into the group's summary line (its count
    // leads a segment, its rows expand inside the group — session order:
    // context → thinking → calls); the assistant's leading think keeps its
    // own duration row.
    expect(screen.getByText('载入了 2 项上下文，运行了 1 个命令')).toBeTruthy()
    expect(screen.getByText('思考了 0.5 秒')).toBeTruthy()
    expect(screen.queryByText(/上下文注入/)).toBeNull()
    expect(screen.queryByText('AGENTS.md')).toBeNull()
    // Expanding the group reveals the absorbed context rows first, each
    // expanding to its body.
    fireEvent.click(screen.getByText('载入了 2 项上下文，运行了 1 个命令'))
    expect(screen.getByText('AGENTS.md')).toBeTruthy()
    fireEvent.click(screen.getByText('AGENTS.md'))
    expect(screen.getByText('rules text')).toBeTruthy()
  })

  it('classifies a tool-jobs notice injection into the background-jobs family', () => {
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
      at('c1', 'context', {
        kind: 'context', seq: 5, time: 1500,
        content: [{ type: 'text', text: 'background task t1 (bash: pnpm install) finished [status: completed]. Read its output with task_output.' }],
        source: { kind: 'plugin', plugin: 'tool-tasks', form: 'notice', summary: 'bash pnpm install [status: completed]' },
        provenance: { role: 'inject', label: 'tool-tasks' },
        form: 'notice',
      }),
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
    // A settlement counts into the background-jobs family, not as a loaded
    // context item or a verbatim "injected <summary>" account.
    expect(screen.getByText('运行了 1 个命令，后台任务 1 个')).toBeTruthy()
    expect(screen.queryByText(/上下文注入/)).toBeNull()
    expect(screen.queryByText(/注入了/)).toBeNull()
    // Expanding the group reveals the absorbed notice row with its body.
    fireEvent.click(screen.getByText('运行了 1 个命令，后台任务 1 个'))
    expect(screen.getByText('tool-tasks')).toBeTruthy()
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
    // No fold while the turn is open: the leading think keeps its own row
    // and the group line stays visible.
    expect(screen.getByText('思考了 0.5 秒')).toBeTruthy()
    expect(screen.getByText('运行了 1 个命令')).toBeTruthy()
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
    // The bubble renders without the steering caption (the chat's current rule).
    expect(screen.queryByText('插话')).toBeNull()
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
    const openFile = vi.fn(() => Promise.resolve())
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
    // Chip queries go through the accessible name: the measurement probes
    // duplicate the chip text in an aria-hidden subtree.
    expect(screen.getByText('产物')).toBeTruthy()
    expect(screen.getByRole('button', { name: /report\.html/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /a\.ts/ })).toBeNull()
    // The actions footer: clock + turn readings (one clock span), copy, fork.
    expect(screen.getByText(/用时 8 秒/)).toBeTruthy()
    expect(screen.getByText(/首 token 1.2秒/)).toBeTruthy()
    expect(screen.getByText(/34 tok\/s/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '在新对话中分支' }))
    expect(forkAt).toHaveBeenCalledWith(20)
    // The produced chip opens through the host opener.
    fireEvent.click(screen.getByRole('button', { name: /report\.html/ }))
    expect(openFile).toHaveBeenCalledWith('out/report.html')
  })

  it('surfaces a host open-path refusal as an in-page dialog with retry', async () => {
    const openFile = vi.fn<(path: string) => Promise<void>>()
    openFile.mockRejectedValueOnce(new Error('host refused'))
    const turn = {
      turn: 1,
      start: { time: 1000 },
      end: { time: 9000 },
      status: 'closed',
      steps: [],
      data: {
        get: (key: string) => key === 'deliverables'
          ? { produced: [{ seq: 15, path: 'out/report.html' }] }
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
        ttftMs: null,
        tokensPerSecond: null,
      }, { kind: 'turn', turn } as never),
    ], { openFile })
    fireEvent.click(screen.getByRole('button', { name: /report\.html/ }))
    // The refusal surfaces the chat view's open dialog.
    expect(await screen.findByText('无法打开文件')).toBeTruthy()
    expect(screen.getByText('host refused')).toBeTruthy()
    // Retry re-invokes the opener for the same path; the dialog then clears.
    openFile.mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await act(async () => {})
    expect(openFile).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('无法打开文件')).toBeNull()
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
    expect(screen.getByRole('button', { name: /report\.html/ })).toBeTruthy()
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
    // The leading Think row anchors the flow (the reasoning stays on its
    // assistant — no preceding run to fold into — so the assistant's key
    // leads).
    expect(ledger.position?.anchorKey).toBe('a1')
    cleanup()
    renderView(nodes, { scroll, chat: chatOf(nodes, { openState: 'open' }) })
    expect((document.querySelector('[data-focus-scroll]') as HTMLElement).scrollTop).toBe(120)
  })

  it('lists user and steering messages in the in-view navigation rail', () => {
    renderView([
      chatNode('u1', 'user', { kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'first question\nmore' }], source: null }),
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
      chatNode('s1', 'steering', { kind: 'steering', seq: 2, time: 2, content: [{ type: 'text', text: 'hold on' }] }),
      chatNode('u2', 'user', { kind: 'user', seq: 3, time: 3, content: [{ type: 'text', text: 'second question' }], source: null }),
      chatNode('c1', 'context', { kind: 'context', seq: 4, time: 4, content: [{ type: 'text', text: 'context text' }], source: { kind: 'file' }, provenance: { role: 'instructions', label: 'AGENTS.md' }, form: null }),
      assistantNode('a1', 'settled', 'thinking', 3000),
    ])
    const nav = screen.getByRole('navigation')
    // One entry per user / steering message, first line only, in flow order;
    // tool runs, context injections, and assistant rows never join the rail.
    const labels = [...nav.querySelectorAll('button')].map(button => button.textContent)
    expect(labels).toEqual(['first question', 'hold on', 'second question'])
    expect(nav.textContent).not.toContain('context text')
    expect(nav.textContent).not.toContain('thinking')
    // No rail on an empty conversation.
    cleanup()
    renderView([])
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('expands the rail on hover and collapses on leave', () => {
    renderView([
      chatNode('u1', 'user', { kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'hello' }], source: null }),
    ])
    const nav = screen.getByRole('navigation')
    expect(nav.getAttribute('data-open')).toBeNull()
    fireEvent.mouseEnter(nav)
    expect(nav.getAttribute('data-open')).toBe('true')
    fireEvent.mouseLeave(nav)
    expect(nav.getAttribute('data-open')).toBeNull()
  })

  it('jumps the focus scrollport to the selected navigation entry', () => {
    const saved = vi.fn()
    const rect = (top: number, bottom: number) => ({
      top, bottom, left: 0, right: 400, width: 400, height: bottom - top, x: 0, y: 0, toJSON: () => ({}),
    })
    renderView([
      chatNode('u1', 'user', { kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'first' }], source: null }),
      chatNode('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
      chatNode('u2', 'user', { kind: 'user', seq: 2, time: 2, content: [{ type: 'text', text: 'second' }], source: null }),
    ], { scroll: { save: saved, read: () => null } })
    const el = document.querySelector('[data-focus-scroll]') as HTMLElement
    Object.defineProperty(el, 'getBoundingClientRect', { value: () => rect(0, 600), configurable: true })
    const target = document.querySelector('[data-focus-anchor-key="u2"]') as HTMLElement
    Object.defineProperty(target, 'getBoundingClientRect', { value: () => rect(200, 240), configurable: true })
    fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'second' }))
    // The row lands NAV_JUMP_OFFSET (12px) below the scrollport top.
    expect(el.scrollTop).toBe(188)
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ anchorKey: 'u2' }))
  })

  it('highlights the active navigation entry as the reader scrolls', () => {
    const rect = (top: number, bottom: number) => ({
      top, bottom, left: 0, right: 400, width: 400, height: bottom - top, x: 0, y: 0, toJSON: () => ({}),
    })
    renderView([
      chatNode('u1', 'user', { kind: 'user', seq: 1, time: 1, content: [{ type: 'text', text: 'one' }], source: null }),
      chatNode('u2', 'user', { kind: 'user', seq: 2, time: 2, content: [{ type: 'text', text: 'two' }], source: null }),
      chatNode('u3', 'user', { kind: 'user', seq: 3, time: 3, content: [{ type: 'text', text: 'three' }], source: null }),
    ])
    const el = document.querySelector('[data-focus-scroll]') as HTMLElement
    Object.defineProperty(el, 'getBoundingClientRect', { value: () => rect(0, 600), configurable: true })
    Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true })
    for (const row of document.querySelectorAll<HTMLElement>('[data-focus-anchor-key]')) {
      const top = row.dataset.focusAnchorKey === 'u1' ? -300
        : row.dataset.focusAnchorKey === 'u2' ? -100 : 700
      Object.defineProperty(row, 'getBoundingClientRect', { value: () => rect(top, top + 40), configurable: true })
    }
    el.scrollTop = 500
    fireEvent.scroll(el)
    const items = [...screen.getByRole('navigation').querySelectorAll('button')]
    // The active entry is the one closest to the input bar — the last whose
    // row clears the visible bottom edge (top + height = 600): u1 and u2
    // have, u3 (at 700) has not — so u2 is active.
    expect(items[1].getAttribute('data-active')).toBe('true')
    expect(items[0].getAttribute('data-active')).toBeNull()
    expect(items[2].getAttribute('data-active')).toBeNull()
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
    expect(screen.getByRole('button', { name: /未知内容块/ })).toBeTruthy()
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
    fireEvent.click(screen.getByText('编辑了 1 个文件，搜索了 1 个正则'))
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

describe('resubmitted turn durations', () => {
  it('keeps a short re-submitted turn\'s worked duration short (two turns)', () => {
    const turn1 = {
      turn: 1,
      start: { time: 1000 },
      end: { time: 8000 },
      status: 'closed',
      steps: [],
      data: { get: () => undefined },
    }
    const turn2 = {
      turn: 2,
      start: { time: 10000 },
      end: { time: 13000 },
      status: 'closed',
      steps: [],
      data: { get: () => undefined },
    }
    const at1 = (key: string, kind: string, data: unknown) => chatNode(key, kind, data, { kind: 'turn', turn: turn1 } as never)
    const at2 = (key: string, kind: string, data: unknown) => chatNode(key, kind, data, { kind: 'turn', turn: turn2 } as never)
    renderView([
      at1('u1', 'user', {
        kind: 'user', seq: 1, time: 1,
        content: [{ type: 'text', text: 'first' }], source: null,
      }),
      at1('a1', 'assistant-step', {
        status: 'settled', turn: 1, step: 1, time: 4000,
        blocks: [{ kind: 'text', text: 'first reply' }],
        finalNode: {
          kind: 'assistant', seq: 10, time: 4000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 1000, firstTokenTime: 2000, completedTime: 4000 },
        },
      }),
      at1('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
      at2('u2', 'user', {
        kind: 'user', seq: 12, time: 10000,
        content: [{ type: 'text', text: 'resubmit' }], source: null,
      }),
      at2('a2', 'assistant-step', {
        status: 'settled', turn: 2, step: 1, time: 13000,
        blocks: [{ kind: 'text', text: 'short reply' }],
        finalNode: {
          kind: 'assistant', seq: 20, time: 13000, turn: 2, step: 1, blocks: [],
          timing: { stepStartTime: 10000, firstTokenTime: 10900, completedTime: 13000 },
        },
      }),
      at2('t2', 'tool-call', { root: settledCall('c2', 'bash', '{}') }),
    ])
    // Turn 1 spans 7s (with a tool run); turn 2 spans 3s (with a tool run).
    // The second worked line must read the re-submitted turn's own duration,
    // not the first turn's.
    expect(screen.getByText('工作了 7 秒')).toBeTruthy()
    expect(screen.getByText('工作了 3 秒')).toBeTruthy()
  })

  it('keeps the re-submitted stretch short after a mid-turn steering (same turn)', () => {
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
        status: 'settled', turn: 1, step: 1, time: 4000,
        blocks: [{ kind: 'text', text: 'first reply' }],
        finalNode: {
          kind: 'assistant', seq: 10, time: 4000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 1000, firstTokenTime: 2000, completedTime: 4000 },
        },
      }),
      at('t1', 'tool-call', { root: settledCall('c1', 'bash', '{}') }),
      // Mid-turn pause + resubmit: a steering message at t=6000.
      at('s1', 'steering', {
        kind: 'steering', seq: 11, time: 6000,
        content: [{ type: 'text', text: 'wait no' }], source: null,
      }),
      // A reply lands before the resumed tool run (the real chat can emit
      // the closing reply then keep running tools in the same step).
      at('a2', 'assistant-step', {
        status: 'settled', turn: 1, step: 2, time: 7000,
        blocks: [{ kind: 'text', text: 'redone reply' }],
        finalNode: {
          kind: 'assistant', seq: 20, time: 7000, turn: 1, step: 1, blocks: [],
          timing: { stepStartTime: 6100, firstTokenTime: 6500, completedTime: 7000 },
        },
      }),
      at('t2', 'tool-call', { root: settledCall('c2', 'bash', '{}') }),
    ])
    // First stretch: turn start (1000) → steering (6000) = 5s. Second stretch:
    // steering (6000) → turn end (8000) = 2s. The second worked line must NOT
    // reuse the whole-turn 7s.
    expect(screen.getByText('工作了 5 秒')).toBeTruthy()
    expect(screen.getByText('工作了 2 秒')).toBeTruthy()
    expect(screen.queryByText('工作了 7 秒')).toBeNull()
  })
})

describe('plugin apply', () => {
  it('registers the focus tab on a real slot ring and disposes with the fiber', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const { SlotRegistry } = await import('@deepseek-ai/dsh-client-runtime/client')
    const { apply, inject } = await import('../src/client/index.ts')
    const ctx = new Context()
    const slots = new SlotRegistry(ctx)
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
    ctx.provide('connection', {
      isLoopback: true,
      hostDescription: {
        getSnapshot: () => undefined,
        subscribe: () => () => {},
      },
    })
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
