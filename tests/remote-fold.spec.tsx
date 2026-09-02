// @vitest-environment jsdom
/** Remote turn folds: index-driven collapsed rows, expand-then-load slices, degradation, and the slice cache. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ChatConversationViewNode, ChatSnapshot, TurnNavigationItem } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TurnIndexResponse, TurnEventsResponse } from '../src/protocol.ts'
import { FocusView } from '../src/client/view/FocusView.tsx'
import type { FocusScrollPosition, FocusViewProps } from '../src/client/contract/props.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const SID = 's1' as SessionId
const t = makeTranslate(zh)

function text(value: string): ContentBlock {
  return { type: 'text', text: value } as ContentBlock
}

/** One settled assistant text block (the AssistantBlock face the chat nodes carry). */
function ablock(value: string): { kind: 'text'; text: string } {
  return { kind: 'text', text: value }
}

/** Minimal chat view node with an explicit anchorSeq (the window-head input). */
function chatNode(
  key: string,
  kind: string,
  data: unknown,
  location: ChatConversationViewNode['location'] = { kind: 'unresolved' },
  anchorSeq = 1,
): ChatConversationViewNode {
  return {
    key, kind, id: key, target: 'chat', anchorSeq,
    location,
    visibility: 'visible',
    data,
  } as never
}

function turnLocation(turn: number): ChatConversationViewNode['location'] {
  return {
    kind: 'turn',
    turn: { turn, start: { seq: 1, time: 1000 }, end: { seq: 90, time: 9000 }, status: 'closed', steps: [], data: { get: () => undefined } },
  } as never
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

type ViewSlice = {
  session: Pick<SessionSnapshot, 'running' | 'hasMore' | 'loadingOlder' | 'queue' | 'openState' | 'openError'>
  chat: ChatSnapshot
}

function chatOf(nodes: ChatConversationViewNode[], opts: { running?: boolean; hasMore?: boolean; openState?: SessionSnapshot['openState'] } = {}): ViewSlice {
  const nodesByKey = new Map(nodes.map(n => [n.key, n]))
  return {
    session: {
      running: opts.running ?? false,
      hasMore: opts.hasMore ?? true,
      loadingOlder: false,
      queue: [],
      openState: opts.openState ?? 'open',
      openError: null,
    },
    chat: {
      order: nodes.map(n => n.key),
      nodes: {
        get: (key: string) => nodesByKey.get(key),
        source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
        processSource: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }),
        values: () => nodes,
      },
      locations: { getTurn: () => [], getStep: () => [] },
      navigation: { items: () => [] as TurnNavigationItem[] },
      timeline: { turnOrder: [], turns: new Map() },
      legacy: {
        nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
      },
    },
  }
}

function viewOf<T>(source: { getSnapshot(): ViewSlice; subscribe(listener: () => void): () => void }, pick: (slice: ViewSlice) => T): HostObservable<T> {
  return {
    getSnapshot: () => pick(source.getSnapshot()),
    subscribe: listener => source.subscribe(listener),
  }
}

interface RenderOptions {
  chat?: ViewSlice
  turnIndex?: (sessionId: SessionId) => Promise<TurnIndexResponse>
  turnEvents?: (sessionId: SessionId, turn: number) => Promise<TurnEventsResponse>
  scroll?: { save: (position: FocusScrollPosition | null) => void; read: () => FocusScrollPosition | null }
}

function renderView(nodes: ChatConversationViewNode[], opts: RenderOptions = {}) {
  const source = createSnapshotStore<ViewSlice>(opts.chat ?? chatOf(nodes))
  const props = {
    sessionId: SID,
    useSession: bindSnapshotSelector(viewOf(source, slice => slice.session)),
    useChat: bindSnapshotSelector(viewOf(source, slice => slice.chat)),
    useSessions: bindSnapshotSelector(sessionsStore('/workspace')),
    useWorkspaces: (() => undefined) as never,
    useProjection: (() => undefined) as never,
    loadImage: () => Promise.reject(new Error('no loader')),
    openFile: () => Promise.resolve(),
    forkAt: () => {},
    fileMentions: () => undefined,
    turnIndex: opts.turnIndex,
    turnEvents: opts.turnEvents,
    isLoopback: true,
    scroll: opts.scroll ?? { save: () => {}, read: () => null },
    useHostHome: (selector: (home: string | undefined) => string | undefined) => selector(undefined),
    useFeedback: (_selector: unknown) => undefined,
    useDiffStyle: (selector: (style: 'default' | 'codex-bar') => 'default' | 'codex-bar') => selector('default'),
    useMdStyle: (selector: (style: 'default' | 'highlight') => 'default' | 'highlight') => selector('default'),
    ensureFeedback: () => Promise.resolve({ ok: true as const }),
    rateFeedback: () => Promise.resolve({ ok: true as const }),
    toggleFeedback: () => Promise.resolve({ ok: true as const }),
    clearFeedbackNote: () => Promise.resolve({ ok: true as const }),
    t,
  } as unknown as FocusViewProps
  return { result: render(<FocusView {...props} />), source }
}

/** One completed turn's summary as the host index would serve it. */
function summary(turn: number, startSeq: number, endSeq: number, reply = ''): TurnIndexResponse['turns'][number] {
  return {
    turn, startSeq, endSeq,
    startTime: startSeq * 1000, endTime: endSeq * 1000,
    stopped: false,
    closingSeq: endSeq - 1, closingMessageId: `m${endSeq - 1}`,
    closingTime: (endSeq - 1) * 1000,
    closingContent: reply === '' ? null : [text(reply)],
    opening: [{ seq: startSeq + 1, time: startSeq * 1000 + 10, role: 'user', content: [text(`ask ${turn}`)] }],
  }
}

/** A tiny completed-turn event slice: one call, one closing reply. */
function turnSliceEvents(turn: number): SessionEvent[] {
  const base = turn * 100
  return [
    { type: 'turn/start', seq: base + 1, time: base * 10, data: { turn } },
    { type: 'step/start', seq: base + 2, time: base * 10 + 100, data: { turn, step: 1 } },
    { type: 'tool/call', seq: base + 3, time: base * 10 + 200, data: { turn, step: 1, callId: `c${turn}`, name: 'bash', arguments: '{"command":"ls"}' } },
    {
      type: 'tool/result', seq: base + 4, time: base * 10 + 300, data: {
        turn, step: 1,
        message: { id: `r${turn}`, role: 'user', content: [{ type: 'tool-result', toolCallId: `c${turn}`, content: [text('ok')], isError: false }], source: { kind: 'tool', callId: `c${turn}` } },
      },
    },
    {
      type: 'assistant/message', seq: base + 5, time: base * 10 + 400, data: {
        turn, step: 1,
        message: { id: `a${turn}`, role: 'assistant', content: [text(`final reply ${turn}`)], source: { kind: 'model', provider: 'p', model: 'm' } },
      },
    },
    { type: 'turn/end', seq: base + 6, time: base * 10 + 500, data: { turn, reason: { kind: 'completed' } } },
  ] as unknown as SessionEvent[]
}

/** The window's nodes: turn 3's residual tail rows and turn 4's rows. */
function windowNodes(): ChatConversationViewNode[] {
  return [
    chatNode('a3', 'assistant-step', {
      status: 'settled', turn: 3, step: 2, time: 61000,
      blocks: [ablock('window residue of turn 3')],
    }, turnLocation(3), 60),
    chatNode('tail3', 'turn-tail', {
      turn: 3, seq: 61, time: 62000, closing: null, branchUnavailable: false,
    }, turnLocation(3), 61),
    chatNode('a4', 'assistant-step', {
      status: 'settled', turn: 4, step: 1, time: 80000,
      blocks: [ablock('turn 4 reply')],
    }, turnLocation(4), 80),
  ]
}

describe('remote turn folds', () => {
  it('renders the index turns before the window head as collapsed folds; the boundary turn keeps its real closing reply', async () => {
    renderView(windowNodes(), {
      turnIndex: () => Promise.resolve({
        turns: [summary(1, 10, 50, 'first reply'), summary(3, 52, 61, 'third reply')],
        cursor: 100,
      }),
    })
    // Turn 1 lies fully beyond the head: the opening bubble, fold line, and
    // closing preview render remotely.
    await waitFor(() => expect(screen.getByText('ask 1')).toBeTruthy())
    expect(screen.getByText('工作了 40 秒')).toBeTruthy()
    expect(screen.getByText('first reply')).toBeTruthy()
    // Turn 3 straddles the head and its index closing (seq 60) sits at it: the
    // fold line renders remotely and the window keeps the real closing reply
    // and tail — no collapsed preview.
    expect(screen.getByText('ask 3')).toBeTruthy()
    expect(screen.getByText('工作了 9 秒')).toBeTruthy()
    expect(screen.getByText('window residue of turn 3')).toBeTruthy()
    expect(screen.queryByText('third reply')).toBeNull()
    // Turn 4 keeps rendering.
    expect(screen.getByText('turn 4 reply')).toBeTruthy()
  })

  it('renders the collapsed fold closing as a real reply row carried by the index', async () => {
    renderView(windowNodes(), {
      turnIndex: () => Promise.resolve({ turns: [summary(1, 10, 50, 'the actual full reply')], cursor: 100 }),
    })
    await waitFor(() => expect(screen.getByText('ask 1')).toBeTruthy())
    // The closing reply renders as a real assistant row from the carried
    // message — not a dim one-line preview.
    expect(screen.getByText('the actual full reply')).toBeTruthy()
    expect(document.querySelector('[data-remote-preview]')).toBeNull()
  })

  it('degrades to the window flow when the index request fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const nodes = windowNodes()
    renderView(nodes, {
      turnIndex: () => Promise.reject(new Error('rpc down')),
    })
    await waitFor(() => expect(warn).toHaveBeenCalled())
    // Degraded: the window flow only.
    expect(screen.getByText('window residue of turn 3')).toBeTruthy()
    expect(screen.queryByText('ask 1')).toBeNull()
  })

  it('renders nothing remotely when the window is fully loaded', async () => {
    const nodes = windowNodes()
    renderView(nodes, {
      turnIndex: () => Promise.resolve({ turns: [summary(1, 10, 50)], cursor: 100 }),
      chat: chatOf(nodes, { hasMore: false }),
    })
    // A fully loaded window has no head: the index turns stay remote-less.
    await waitFor(() => expect(screen.getByText('turn 4 reply')).toBeTruthy())
    expect(screen.queryByText('ask 1')).toBeNull()
  })

  it('keeps the window-only flow when the view has no index binding', () => {
    renderView(windowNodes())
    expect(screen.getByText('window residue of turn 3')).toBeTruthy()
    expect(screen.queryByText('ask 1')).toBeNull()
  })

  it('expands on click: fetches the slice, projects the rows, and shows them once', async () => {
    const turnEvents = vi.fn((_sessionId: SessionId, turn: number) =>
      Promise.resolve({ startSeq: 11, endSeq: 16, events: turnSliceEvents(turn) }))
    renderView(windowNodes(), {
      turnIndex: () => Promise.resolve({ turns: [summary(1, 10, 50, 'final reply 1')], cursor: 100 }),
      turnEvents: turnEvents as unknown as (sessionId: SessionId, turn: number) => Promise<TurnEventsResponse>,
    })
    await waitFor(() => expect(screen.getByText('工作了 40 秒')).toBeTruthy())
    fireEvent.click(screen.getByText('工作了 40 秒'))
    // Loading hint, then the projected body: work group, closing reply, tail.
    await waitFor(() => expect(screen.getByText('final reply 1')).toBeTruthy())
    expect(turnEvents).toHaveBeenCalledTimes(1)
    expect(turnEvents).toHaveBeenCalledWith(SID, 1)
    expect(screen.getByText('Bash')).toBeTruthy()
    // The collapsed preview never paints; the opening bubbles stay.
    expect(screen.getByText('ask 1')).toBeTruthy()
    expect(document.querySelector('[data-remote-preview]')).toBeNull()
    // Collapse keeps the slice cached: no second fetch.
    fireEvent.click(screen.getByText('工作了 40 秒'))
    expect(screen.queryByText('final reply 1')).toBeNull()
    expect(turnEvents).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('工作了 40 秒'))
    await waitFor(() => expect(screen.getByText('final reply 1')).toBeTruthy())
    expect(turnEvents).toHaveBeenCalledTimes(1)
  })

  it('expands a boundary turn into the work rows only, keeping the window-rendered closing reply once', async () => {
    const turnEvents = vi.fn((_sessionId: SessionId, turn: number) =>
      Promise.resolve({ startSeq: 52, endSeq: 61, events: turnSliceEvents(turn) }))
    renderView(windowNodes(), {
      turnIndex: () => Promise.resolve({ turns: [summary(3, 52, 61, 'third reply')], cursor: 100 }),
      turnEvents: turnEvents as unknown as (sessionId: SessionId, turn: number) => Promise<TurnEventsResponse>,
    })
    await waitFor(() => expect(screen.getByText('工作了 9 秒')).toBeTruthy())
    fireEvent.click(screen.getByText('工作了 9 秒'))
    // The projected body carries the work rows only: the real closing reply
    // ("window residue of turn 3") keeps rendering exactly once from the
    // window rows below the fold.
    await waitFor(() => expect(screen.getByText('Bash')).toBeTruthy())
    expect(turnEvents).toHaveBeenCalledTimes(1)
    expect(turnEvents).toHaveBeenCalledWith(SID, 3)
    expect(screen.getAllByText('window residue of turn 3')).toHaveLength(1)
    expect(document.querySelector('[data-remote-preview]')).toBeNull()
    // Collapse hides the work rows; the window-rendered closing stays.
    fireEvent.click(screen.getByText('工作了 9 秒'))
    expect(screen.queryByText('Bash')).toBeNull()
    expect(screen.getByText('window residue of turn 3')).toBeTruthy()
  })

  it('surfaces a failed slice inline with a working retry', async () => {
    let attempts = 0
    const turnEvents = vi.fn(() => {
      attempts += 1
      return attempts === 1
        ? Promise.reject(new Error('slice rpc failed'))
        : Promise.resolve({ startSeq: 11, endSeq: 16, events: turnSliceEvents(1) })
    })
    renderView(windowNodes(), {
      turnIndex: () => Promise.resolve({ turns: [summary(1, 10, 50)], cursor: 100 }),
      turnEvents: turnEvents as unknown as (sessionId: SessionId, turn: number) => Promise<TurnEventsResponse>,
    })
    await waitFor(() => expect(screen.getByText('工作了 40 秒')).toBeTruthy())
    fireEvent.click(screen.getByText('工作了 40 秒'))
    const retry = await screen.findByText('重试')
    expect(screen.getByText('slice rpc failed')).toBeTruthy()
    fireEvent.click(retry)
    await waitFor(() => expect(screen.getByText('final reply 1')).toBeTruthy())
    expect(attempts).toBe(2)
  })

  it('defers the first-frame scroll restore until the index request settles', async () => {
    const saved: FocusScrollPosition[] = []
    const deferred: Array<(response: TurnIndexResponse) => void> = []
    const scroll = {
      save: (position: FocusScrollPosition | null) => { saved.push(position as FocusScrollPosition) },
      read: () => null,
    }
    renderView(windowNodes(), {
      scroll,
      turnIndex: () => new Promise(resolve => { deferred.push(resolve) }),
    })
    // The restore (which saves the fresh-open null ledger) has not run yet.
    expect(saved).toHaveLength(0)
    await waitFor(() => expect(deferred).toHaveLength(1))
    deferred[0]?.({ turns: [], cursor: 100 })
    await waitFor(() => expect(saved.length).toBeGreaterThan(0))
    // The remote rows render from the same settled frame.
    expect(screen.getByText('turn 4 reply')).toBeTruthy()
  })

  it('evicts expanded-turn slices past the LRU bound and refetches on re-expansion', async () => {
    const turns = Array.from({ length: 13 }, (_, index) => summary(index + 1, 10 + index, 40 + index))
    const fetched: number[] = []
    const turnEvents = vi.fn((_sessionId: SessionId, turn: number) => {
      fetched.push(turn)
      return Promise.resolve({ startSeq: turn * 100 + 1, endSeq: turn * 100 + 6, events: turnSliceEvents(turn) })
    })
    const nodes = windowNodes()
    renderView(nodes, {
      chat: chatOf(nodes),
      turnIndex: () => Promise.resolve({ turns, cursor: 100 }),
      turnEvents: turnEvents as unknown as (sessionId: SessionId, turn: number) => Promise<TurnEventsResponse>,
    })
    await waitFor(() => expect(screen.getAllByText('工作了 30 秒')).toHaveLength(13))
    for (const turn of turns) {
      const lines = screen.getAllByText('工作了 30 秒')
      const fold = lines[turn.turn - 1]
      if (fold === undefined) throw new Error(`missing fold line for turn ${turn.turn}`)
      fireEvent.click(fold)
    }
    await waitFor(() => expect(fetched).toHaveLength(13))
    // Re-expanding the evicted first turn refetches it — and its re-insertion
    // evicts the new oldest entry (turn 2), which then refetches on its next
    // expansion: the cache keeps the twelve most recently expanded turns.
    fireEvent.click(screen.getAllByText('工作了 30 秒')[0])
    await waitFor(() => expect(fetched.filter(turn => turn === 1)).toHaveLength(2))
    fireEvent.click(screen.getAllByText('工作了 30 秒')[1])
    await waitFor(() => expect(fetched.filter(turn => turn === 2)).toHaveLength(2))
  })

  it('switches a paged-in turn from the remote fold back to the window rows', async () => {
    const nodes = windowNodes()
    const { source } = renderView(nodes, {
      turnIndex: () => Promise.resolve({ turns: [summary(3, 52, 61, 'third reply')], cursor: 100 }),
    })
    await waitFor(() => expect(screen.getByText('ask 3')).toBeTruthy())
    // The boundary turn's index closing (seq 60) sits at the head: the window
    // keeps the real closing reply and tail below the remote fold.
    expect(screen.getByText('window residue of turn 3')).toBeTruthy()
    // The window head lifts (the session window itself grows): turn 3 rejoins
    // the window and the remote fold drops out.
    act(() => {
      source.set(chatOf([
        chatNode('u3', 'user', {
          kind: 'user', seq: 53, time: 53000, content: [text('ask 3 in window')], source: null,
        }, turnLocation(3), 53),
        ...nodes,
      ], { hasMore: false }))
    })
    expect(screen.queryByText('ask 3')).toBeNull()
    expect(screen.getByText('window residue of turn 3')).toBeTruthy()
  })

  it('pages the fold stack: the newest page renders first and the pager prepends older folds', async () => {
    // 53 pre-head turns (turn numbers 10..62 keep clear of the window
    // fixture's turn 3): only the newest 50 render at first.
    const turns = Array.from({ length: 53 }, (_, index) => summary(10 + index, 1 + index, 5 + index))
    renderView(windowNodes(), {
      turnIndex: () => Promise.resolve({ turns, cursor: 100 }),
    })
    await waitFor(() => expect(screen.getAllByText('工作了 4 秒')).toHaveLength(50))
    // The oldest three turns sit behind the pager.
    expect(screen.queryByText('ask 10')).toBeNull()
    expect(screen.queryByText('ask 11')).toBeNull()
    expect(screen.queryByText('ask 12')).toBeNull()
    expect(screen.getByText('ask 13')).toBeTruthy()
    expect(screen.getByText('加载更早的回合')).toBeTruthy()
    // One click prepends the next page: the whole index is folded in.
    fireEvent.click(screen.getByText('加载更早的回合'))
    await waitFor(() => expect(screen.getAllByText('工作了 4 秒')).toHaveLength(53))
    expect(screen.getByText('ask 10')).toBeTruthy()
    // The pager hides once every pre-head turn renders.
    expect(screen.queryByText('加载更早的回合')).toBeNull()
  })

  it('keeps the pager hidden while every pre-head turn already renders', async () => {
    const turns = [summary(1, 10, 50), summary(3, 52, 61)]
    renderView(windowNodes(), {
      turnIndex: () => Promise.resolve({ turns, cursor: 100 }),
    })
    await waitFor(() => expect(screen.getByText('ask 1')).toBeTruthy())
    expect(screen.getByText('ask 3')).toBeTruthy()
    expect(screen.queryByText('加载更早的回合')).toBeNull()
  })
})
