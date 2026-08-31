import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Button, IconChevronDownOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions, MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-chat merge (useChat on the session standard kit).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TurnNavigationItem, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { FocusScrollPosition, FocusViewProps } from '../contract/props.ts'
import { buildFocusFlow, createFlowBuildCache, LIVE_ROW_THRESHOLD_MS, projectTurnSlice } from '../model/index.ts'
import type { FocusFlowItem, FocusToolRow, TurnSlice } from '../model/index.ts'
import type { TurnSummary } from '../../protocol.ts'
import { markdownLabels } from './helpers/terminal.ts'
import { FlowRow, flowKey } from './rows/FlowRow.tsx'
import { PendingSteeringBubble } from './rows/UserBubble.tsx'
import { RemoteTurnRow } from './rows/RemoteTurnRow.tsx'
import { ToolCallRow } from './rows/ToolCallRow.tsx'
import { RunningStatus } from './chrome/RunningStatus.tsx'
import { TurnNavigator } from './chrome/TurnNavigator.tsx'
import type { FocusFeedbackActions } from './chrome/MessageFeedbackActions.tsx'
import css from './FocusView.module.css'

/** The remote-turn slice cache holds at most this many expanded turns. */
const SLICE_CACHE_LIMIT = 12

/** How many pre-head turn folds render at first, and how many the pager above
 *  the stack prepends per click (the chat window's 50-message rhythm). */
const FOLD_PAGE = 50

/** The turn-index fetch lifecycle for one session. */
type TurnIndexState =
  | { status: 'pending' }
  | { status: 'ready'; turns: readonly TurnSummary[] }
  | { status: 'failed' }

/** Latest open turn's logged start time, mirroring the chat view's clock anchor. */
function runningTurnStartTime(timeline: ConversationTimelineSnapshot): number | null {
  let latest: number | null = null
  for (const turn of timeline.turns.values()) {
    if (turn.status === 'open' && turn.start !== undefined) latest = turn.start.time
  }
  return latest
}

/** Elapsed clock copy: whole seconds, minute-padded past 60 (the chat view's rhythm). */

const FOLLOW_THRESHOLD = 24

/** Where a nav jump places the entry row: a small gap under the scrollport top. */
const NAV_JUMP_OFFSET = 12

/** The Turn one flow row belongs to (the official rail's mark anchor). */
function flowTurnOf(item: FocusFlowItem, chat: ChatSnapshot): number | null {
  // Remote turns carry no rail anchor (the rail lists window turns only).
  if (item.kind === 'remote-turn') return null
  if (item.kind === 'turn-fold' || item.kind === 'turn-tail') return item.turn
  if (item.kind === 'tools') {
    const nodeKey = item.group.nodeKeys[0]
    if (nodeKey === undefined) return null
    const location = chat.nodes.get(nodeKey)?.location
    return location !== undefined && (location.kind === 'turn' || location.kind === 'step')
      ? location.turn?.turn ?? null
      : null
  }
  const location = chat.nodes.get(item.nodeKey)?.location
  if (location === undefined || (location.kind !== 'turn' && location.kind !== 'step')) return null
  return location.turn?.turn ?? null
}

/** Turn owning the row at a scrollport line; scroll frames are hot, so this
 *  hit-tests the line first and falls back to one row scan when layout cannot
 *  answer (jsdom, pre-paint). */
function turnAtLine(list: HTMLElement, line: number): number | null {
  const content = list.getBoundingClientRect()
  if (typeof document.elementsFromPoint === 'function' && content.width > 0) {
    for (const element of document.elementsFromPoint(content.left + content.width / 2, line)) {
      const row = element instanceof HTMLElement ? element.closest<HTMLElement>('[data-focus-turn]') : null
      const turn = Number(row?.dataset.focusTurn)
      if (row !== null && list.contains(row) && Number.isSafeInteger(turn)) return turn
    }
  }
  let found: number | null = null
  for (const row of list.querySelectorAll<HTMLElement>('[data-focus-turn]')) {
    if (row.getBoundingClientRect().top > line) break
    const turn = Number(row.dataset.focusTurn)
    if (Number.isSafeInteger(turn)) found = turn
  }
  return found
}

/** Active conversation column host when present; otherwise the view-local scroller. */
function scrollerOf(from: HTMLElement): HTMLElement {
  return from.closest('[data-conversation-scroll]') ?? from
}

/** Publish the focus scrollport's live measurements the turn navigator's
 *  rail reads (--dsh-conversation-viewport-height / --dsh-composer-height /
 *  --dsh-composer-side-clearance) — the same variables the official chat's
 *  ConversationRoot publishes on its scroller. The focus view scrolls the
 *  shared conversation column in the app but must not depend on the chat
 *  root being mounted, so it measures the band itself.
 * @param scroller - the resolved scroll container.
 */
function publishNavigatorMetrics(scroller: HTMLElement): void {
  const seat = scroller.querySelector<HTMLElement>('[data-composer-seat]')
  scroller.style.setProperty('--dsh-composer-height', `${seat?.offsetHeight ?? 0}px`)
  scroller.style.setProperty('--dsh-conversation-viewport-height', `${scroller.clientHeight}px`)
  // The official ConversationRoot's resting clearance; the rail gives the
  // transcript side padding back with it.
  scroller.style.setProperty('--dsh-composer-side-clearance', '16px')
}

/** Find an already-rendered settled flow row without interpolating a selector. */
function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>('[data-focus-anchor-key]')) {
    if (row.dataset.focusAnchorKey === key) return row
  }
  return null
}

/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/** Select a visible stable flow identity, falling back only when layout has not exposed a visible box yet. */
function pagingAnchor(list: HTMLElement, scrollport: HTMLElement): HTMLElement | null {
  const viewport = scrollport.getBoundingClientRect()
  // The sticky composer covers the bottom of the scrollport in the app: the
  // visible area ends at its top, exactly where the chat view draws it.
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composer?.getBoundingClientRect().top ?? viewport.bottom
  // Scroll events are hot: hit-test a few points through the stretched flow
  // rows before considering the full mounted set. The fallback keeps jsdom
  // and pre-layout states deterministic.
  if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
    const content = list.getBoundingClientRect()
    const left = Math.max(viewport.left, content.left)
    const right = Math.min(viewport.right, content.right)
    const x = left + Math.max(0, right - left) / 2
    const height = visibleBottom - viewport.top
    const points = [1, Math.min(32, height / 3), height / 2, Math.max(1, height - 1)]
    for (const offset of points) {
      for (const element of document.elementsFromPoint(x, viewport.top + offset)) {
        const row = element instanceof HTMLElement
          ? element.closest<HTMLElement>('[data-focus-anchor-key]')
          : null
        if (row !== null && list.contains(row)) return row
      }
    }
  }
  const rows = [...list.querySelectorAll<HTMLElement>('[data-focus-anchor-key]')]
  const visibleRows = rows.filter((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < visibleBottom
  })
  return visibleRows[0] ?? rows[0] ?? null
}

/** Capture a reflow-resistant reader position from the current rendered window. */
function scrollPosition(list: HTMLElement, scrollport: HTMLElement): FocusScrollPosition | null {
  const row = pagingAnchor(list, scrollport)
  const anchorKey = row?.dataset.focusAnchorKey
  if (row === null || anchorKey === undefined) return null
  return {
    anchorKey,
    anchorTop: flowTop(row, scrollport),
    scrollTop: scrollport.scrollTop,
  }
}

/** Host/OS refusal text for the file-open dialog; empty throws keep a locale fallback. */
function openFailureMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return message === '' ? fallback : message
}

/** ProducedFiles opens the session workspace as `.`. */
function isFolderOpenPath(path: string): boolean {
  return path === '.'
}

/** The chat view's in-page Host open-path refusal: the wire reason plus a retry of the same path. */
function FileOpenErrorDialog({ path, message, busy, onClose, onRetry, t }: {
  path: string
  message: string
  busy: boolean
  onClose: () => void
  onRetry: () => void
  t: FocusViewProps['t']
}) {
  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('close')}
      title={t(isFolderOpenPath(path) ? 'fileOpen.folderTitle' : 'fileOpen.title')}
      description={message}
      footer={(
        <>
          <Button variant="outline" className={css.modalAction} onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" className={css.modalAction} disabled={busy} onClick={onRetry}>{t('retry')}</Button>
        </>
      )}
    />
  )
}

/**
 * The focus view slot entry: pure component over the composed props. Scroll
 * follows the chat view's ledger: the resolved scrollport (the shared
 * conversation column in the app, the view itself in tests) keeps reader
 * positions saved continuously on scroll and restored on mount.
 * @param props - conversation view standard kit and the focus locale seat.
 */

export function FocusView({
  useSession, useChat, sessionId, useSessions, loadImage, openFile, forkAt, fileMentions,
  turnIndex, turnEvents, isLoopback, scroll, useHostHome, useFeedback,
  useDiffStyle, useMdStyle,
  ensureFeedback, rateFeedback, toggleFeedback, clearFeedbackNote, t,
}: FocusViewProps) {
  // Lifecycle and control state ride useSession (the Session Controller's
  // SessionSnapshot); conversation content rides useChat (the Chat target's
  // ChatSnapshot). Subscribing to the whole chat snapshot keeps the flow
  // fresh on every publication — including assistant-only updates that leave
  // the order array untouched, which is what folds a finished Think row back
  // in. The snapshot's outer wrapper is rebuilt on every stream frame, so
  // the view re-derives each frame too — but the cross-build derivation
  // cache below makes an unchanged build cheap (reference checks only) and
  // keeps every settled row's object identity, so memoized rows bail out
  // exactly like the chat view's per-node seats.
  const chat = useChat(s => s)
  const running = useSession(s => s.running)
  const hasMore = useSession(s => s.hasMore)
  const inbox = useSession(s => s.queue)
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  // Host account home: a leftover POSIX home path in a tool summary or read
  // card displays as `~` (the ui-tool chat rule).
  const home = useHostHome(home => home)
  // The view preferences (bound as selector hooks by the slot renderer):
  // the diff renderer for file-mutation cards and the markdown inline-code
  // rendering, both defaulting to the official surfaces.
  const diffStyle = useDiffStyle(style => style)
  const mdStyle = useMdStyle(style => style)
  const pendingSteering = useMemo(
    () => inbox.filter(item => item.placement === 'steering'),
    [inbox],
  )
  // Cross-build derivation cache: unchanged nodes keep their flow item and
  // tool-row identities, so memoized rows bail out during streaming.
  const flowCacheRef = useRef(createFlowBuildCache())
  // The Host's completed-turn index (the remote turn folds): one fetch per
  // session; a rejection — or an absent optional service — degrades to the
  // window-only flow. The first-frame scroll restore waits for this request
  // to settle, so the opening frame already carries the folded overview.
  const [turnIndexState, setTurnIndexState] = useState<TurnIndexState>({ status: 'pending' })
  // The rendered fold stack is paged: only the newest FOLD_PAGE pre-head turns
  // render at first, and the pager above the stack prepends older ones from
  // the already-fetched index. A turn's process detail loads on expand only.
  const [foldLimit, setFoldLimit] = useState(FOLD_PAGE)
  useEffect(() => {
    let cancelled = false
    setTurnIndexState({ status: 'pending' })
    setFoldLimit(FOLD_PAGE)
    if (turnIndex === undefined) {
      setTurnIndexState({ status: 'ready', turns: [] })
      return () => { cancelled = true }
    }
    turnIndex(sessionId).then(
      response => { if (!cancelled) setTurnIndexState({ status: 'ready', turns: response.turns }) },
      (cause: unknown) => {
        if (cancelled) return
        console.warn('dsh-focus-chat: the turn index failed; rendering the window flow only', cause)
        setTurnIndexState({ status: 'failed' })
      },
    )
    return () => { cancelled = true }
  }, [turnIndex, sessionId])
  // The loaded window's first log position: every turn whose slice starts
  // before it renders as a remote fold. A fully loaded window (no older
  // pages) has no head, so nothing renders remotely.
  const windowHead = useMemo(() => {
    if (!hasMore) return 0
    let min = Infinity
    for (const node of chat.nodes.values()) {
      if (node.anchorSeq < min) min = node.anchorSeq
    }
    return Number.isFinite(min) ? min : 0
  }, [chat, hasMore])
  // The pre-head turns: index turns entirely or partially before the window
  // head, in log order. A turn that later pages into the window drops out of
  // this list on its own (the head moves down), and the window rows resume.
  const preHeadTurns = useMemo(() => {
    if (turnIndexState.status !== 'ready' || windowHead === 0) return []
    return turnIndexState.turns.filter(summary => summary.startSeq < windowHead)
  }, [turnIndexState, windowHead])
  // The rendered folds: the newest FOLD_PAGE pre-head turns. Older ones stay
  // behind the pager above the stack — the fold overview stays bounded, and
  // each fold's process detail loads on expand.
  const remoteTurns = useMemo(
    () => preHeadTurns.slice(Math.max(0, preHeadTurns.length - foldLimit)),
    [preHeadTurns, foldLimit],
  )
  // The keep-from rule per pre-head turn: when the index's closing reply sits
  // at or above the window head, the window itself paints the real closing
  // reply and turn tail — the fold line keeps only the rows below it, and the
  // row draws no collapsed reply of its own. An index closing beyond the
  // window head hides the whole turn (the remote fold renders the reply).
  const hideFrom = useMemo(() => {
    const map = new Map<number, number>()
    for (const summary of preHeadTurns) {
      map.set(summary.turn, summary.closingSeq !== null && summary.closingSeq >= windowHead
        ? summary.closingSeq
        : Number.POSITIVE_INFINITY)
    }
    return map
  }, [preHeadTurns, windowHead])
  // Expanded-turn slice cache: the projected flow items per turn, LRU-bounded
  // (an expanded fold's rows stay warm while the reader scrolls back to it).
  const slicesRef = useRef(new Map<number, TurnSlice>())
  const [sliceVersion, bumpSliceVersion] = useReducer(count => count + 1, 0)
  const requestTurnSlice = useCallback(async (turn: number): Promise<void> => {
    if (turnEvents === undefined) throw new Error('turn slices are unavailable')
    const cache = slicesRef.current
    if (cache.has(turn)) {
      bumpSliceVersion()
      return
    }
    const response = await turnEvents(sessionId, turn)
    const slice = projectTurnSlice(response.events, cwd, home)
    // LRU refresh: re-insertion moves the turn to the newest end.
    cache.delete(turn)
    while (cache.size >= SLICE_CACHE_LIMIT) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
    cache.set(turn, slice)
    bumpSliceVersion()
  }, [turnEvents, sessionId, cwd, home])
  const flow = useMemo(() => {
    const windowFlow = buildFocusFlow(
      chat.order, key => chat.nodes.get(key), cwd, home, flowCacheRef.current,
      hideFrom.size > 0 ? hideFrom : undefined,
    )
    if (remoteTurns.length === 0) return windowFlow
    const remote = remoteTurns.map(summary => {
      const slice = slicesRef.current.get(summary.turn)
      return {
        kind: 'remote-turn' as const,
        nodeKey: `remote-turn:${summary.turn}`,
        turn: summary.turn,
        summary,
        state: slice === undefined ? 'collapsed' as const : 'loaded' as const,
        keepClosing: summary.closingSeq !== null && summary.closingSeq >= windowHead,
        work: slice?.work ?? [],
        closing: slice?.closing ?? null,
        tail: slice?.tail ?? null,
        error: null,
      }
    })
    return [...remote, ...windowFlow]
    // sliceVersion: a slice landing re-composes the remote rows with the
    // cached projection; the window flow's identities survive unchanged.
  }, [chat, cwd, home, hideFrom, remoteTurns, sliceVersion])
  // The official turn-navigation rail's items, accumulated in the Chat
  // snapshot: the array identity moves only when a Turn enters, leaves, or
  // changes its preview.
  const turnNavigationItems = chat.navigation.items()
  // The live-row debounce: a running call paints nothing until it has run
  // LIVE_ROW_THRESHOLD_MS — a fast call would otherwise flash a live row
  // that settles into the summary a moment later (the flicker fix). The
  // clock advances on snapshot changes and once the youngest call crosses
  // the window.
  const [liveNow, setLiveNow] = useState(() => Date.now())
  useEffect(() => {
    let remaining = Infinity
    for (const item of flow) {
      if (item.kind !== 'tools' || !item.group.running) continue
      for (const row of item.group.items) {
        if (!('callId' in row) || row.state !== 'running' || row.time === null) continue
        const left = LIVE_ROW_THRESHOLD_MS - (Date.now() - row.time)
        if (left > 0 && left < remaining) remaining = left
      }
    }
    if (remaining === Infinity) return
    const timer = window.setTimeout(() => { setLiveNow(Date.now()) }, remaining + 16)
    return () => { window.clearTimeout(timer) }
  }, [flow, liveNow])
  // The current step's running calls: live rows at the END of the flow —
  // below the model's output text — that fold into their group's summary
  // line once settled (the chat live row's position, the think lifecycle).
  // Young calls are held back by the debounce.
  const runningCalls = useMemo(() => {
    const rows: FocusToolRow[] = []
    for (const item of flow) {
      if (item.kind !== 'tools' || !item.group.running) continue
      for (const row of item.group.items) {
        if (!('callId' in row) || row.state !== 'running') continue
        if (row.time === null || liveNow - row.time >= LIVE_ROW_THRESHOLD_MS) rows.push(row)
      }
    }
    return rows
  }, [flow, liveNow])
  const runningTurnStart = useMemo(() => runningTurnStartTime(chat.timeline), [chat.timeline])
  const mdLabels = useMemo<MarkdownLabels>(() => markdownLabels(t), [t])
  // Host open-path refusals surface as an in-page dialog with a same-path
  // retry (the chat view's FileOpenErrorDialog); a settlement that started
  // before the latest close/retry gesture is ignored so a cancelled in-flight
  // refusal never reopens the dialog.
  // The per-message feedback verbs (the assistant-actions strip's business
  // face), bound to this Session's controller by the apply side. Stable
  // identity across renders: memoized rows compare it shallowly.
  const feedback = useMemo<FocusFeedbackActions>(() => ({
    useFeedback,
    ensure: ensureFeedback,
    rate: rateFeedback,
    toggle: toggleFeedback,
    clearNote: clearFeedbackNote,
  }), [useFeedback, ensureFeedback, rateFeedback, toggleFeedback, clearFeedbackNote])
  const [fileOpenError, setFileOpenError] = useState<{ path: string; message: string } | null>(null)
  const [fileOpenBusy, setFileOpenBusy] = useState(false)
  const fileOpenRequest = useRef(0)
  const requestOpenFile = useCallback((path: string) => {
    const id = ++fileOpenRequest.current
    setFileOpenBusy(true)
    void openFile(path).then(
      () => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError(null)
        setFileOpenBusy(false)
      },
      (error: unknown) => {
        if (id !== fileOpenRequest.current) return
        setFileOpenError({
          path,
          message: openFailureMessage(
            error,
            t(isFolderOpenPath(path) ? 'fileOpen.folderUnknown' : 'fileOpen.unknown'),
          ),
        })
        setFileOpenBusy(false)
      },
    )
  }, [openFile, t])
  const closeFileOpenError = useCallback(() => {
    fileOpenRequest.current += 1
    setFileOpenError(null)
    setFileOpenBusy(false)
  }, [])
  // Inline file-mention vocabulary for closing assistants: the engine turn
  // data names the closing seq, the optional chatFileMentions service
  // resolves its prose tokens (absent service leaves the prose inert). The
  // map is keyed on the assistant nodes that actually changed (reference
  // comparison) rather than the whole chat identity, so memoized rows see a
  // stable `mentionsByKey` while only the streaming tail moves.
  const mentionsMapRef = useRef<ReadonlyMap<string, MarkdownFileMentions | undefined>>(new Map())
  const mentionsSourceRef = useRef<ReadonlyMap<string, unknown>>(new Map())
  const mentionsByKey = useMemo(() => {
    const map = new Map<string, MarkdownFileMentions | undefined>()
    let changed = false
    for (const item of flow) {
      if (item.kind !== 'assistant' || item.finalSeq === null) continue
      const node = chat.nodes.get(item.nodeKey)
      if (node === undefined || node.data === mentionsSourceRef.current.get(item.nodeKey)) continue
      const location = node.location
      const turn = location?.kind === 'turn' || location?.kind === 'step' ? location.turn : undefined
      const tail = turn?.data.get('turn-tail')
      if (turn === undefined || tail?.closing?.finalNode.seq !== item.finalSeq) continue
      changed = true
      map.set(item.nodeKey, fileMentions({ turn, seq: item.finalSeq, openFile }))
    }
    if (!changed) return mentionsMapRef.current
    const nextSources = new Map(mentionsSourceRef.current)
    for (const item of flow) {
      if (item.kind !== 'assistant' || item.finalSeq === null) continue
      const node = chat.nodes.get(item.nodeKey)
      if (node !== undefined) nextSources.set(item.nodeKey, node.data)
    }
    const next = new Map(mentionsMapRef.current)
    for (const [key, value] of map) next.set(key, value)
    mentionsSourceRef.current = nextSources
    mentionsMapRef.current = next
    return next
  }, [chat, fileMentions, flow, openFile])

  const listRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  // The turn navigator's rail reads the scrollport band (viewport minus
  // composer); publish the measurements like the official chat's
  // ConversationRoot does, so the rail floats correctly even when the chat
  // root is not mounted (the focus tab owns the column).
  const navigatorObserver = useRef<ResizeObserver | null>(null)
  const navigatorMetricsRef = useCallback((node: HTMLDivElement | null): void => {
    listRef.current = node
    navigatorObserver.current?.disconnect()
    navigatorObserver.current = null
    if (node === null) return
    const scroller = scrollerOf(node)
    publishNavigatorMetrics(scroller)
    // jsdom (tests) has no ResizeObserver: publish the first measurements and
    // skip the live re-measurement (the rail still renders).
    if (typeof ResizeObserver === 'undefined') return
    const seat = scroller.querySelector<HTMLElement>('[data-composer-seat]')
    const observer = new ResizeObserver(() => { publishNavigatorMetrics(scroller) })
    observer.observe(scroller)
    if (seat !== null) observer.observe(seat)
    navigatorObserver.current = observer
  }, [])
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  /** The official turn rail's active mark (the Turn owning the reading line). */
  const [activeTurn, setActiveTurn] = useState<number | null>(
    () => turnNavigationItems.at(-1)?.turn ?? null,
  )
  /** Last position delivered or written on the main thread. */
  const observedTopRef = useRef(0)
  /** Paging anchor: semantic row/position at click, restored after the prepend lands. */
  const anchorRef = useRef<{ key: string; top: number } | null>(null)
  const openedRef = useRef(false)
  const firstKeyRef = useRef<string | null>(null)
  const lastKeyRef = useRef<string | null>(null)
  /** Flow tip signature — follow-scroll only when this moves, never on a
   *  scroll-driven chrome re-render. */
  const followSigRef = useRef<string | null>(null)

  const lastItem = flow.at(-1)
  const firstKey = flow[0] === undefined ? null : flowKey(flow[0])
  const lastKey = lastItem === undefined ? null : flowKey(lastItem)
  const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? ''
  const followSig = `${openState}:${firstKey}:${lastKey}:${flow.length}:${running ? 1 : 0}:${lastSteeringId}`

  const toBottom = (el: HTMLElement): void => {
    anchorRef.current = null
    el.scrollTop = el.scrollHeight
    observedTopRef.current = el.scrollTop
    atBottomRef.current = true
    setAtBottom(true)
    setActiveTurn(turnNavigationItems.at(-1)?.turn ?? null)
    scroll.save(null)
  }

  useLayoutEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    // First-frame gating: the opening scroll restore waits for the turn-index
    // request, so the first painted frame already carries the folded overview
    // and the restore never displaces.
    if (openState === 'open' && !openedRef.current && turnIndexState.status === 'pending') return
    const el = scrollerOf(local)
    // Mount (once the session is open — the chat view's gate): restore the
    // saved position — unless the reader was pinned to the bottom, which
    // clears the ledger (view-tab switch away and back keeps the place; a
    // fresh open follows the floor).
    if (openState === 'open' && !openedRef.current) {
      openedRef.current = true
      const saved = scroll.read()
      if (saved === null) {
        toBottom(el)
      } else {
        el.scrollTop = saved.scrollTop
        const row = anchorElement(local, saved.anchorKey)
        if (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop
        observedTopRef.current = el.scrollTop
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
        atBottomRef.current = isAtBottom
        setAtBottom(isAtBottom)
        scroll.save(isAtBottom ? null : scrollPosition(local, el))
      }
      firstKeyRef.current = firstKey
      lastKeyRef.current = lastKey
      followSigRef.current = followSig
      return
    }
    // Prepend (head moved): preserve the settled row the reader anchored at click.
    if (anchorRef.current !== null && firstKey !== null && firstKeyRef.current !== null && firstKey !== firstKeyRef.current) {
      const anchor = anchorRef.current
      anchorRef.current = null
      const row = anchorElement(local, anchor.key)
      if (row !== null) el.scrollTop += flowTop(row, el) - anchor.top
      observedTopRef.current = el.scrollTop
      firstKeyRef.current = firstKey
      lastKeyRef.current = lastKey
      followSigRef.current = followSig
      return
    }
    firstKeyRef.current = firstKey
    // Own words must be visible: a new trailing user node force-scrolls.
    const appendedUser = lastKey !== lastKeyRef.current && lastItem?.kind === 'message'
      && (lastItem.role === 'user' || lastItem.role === 'steering')
    const tipMoved = followSigRef.current !== followSig
    lastKeyRef.current = lastKey
    followSigRef.current = followSig
    // Follow new flow content while pinned; do NOT re-pin on every render.
    if (appendedUser || (tipMoved && atBottomRef.current)) toBottom(el)
  })

  // The official turn rail's active mark: the Turn owning the row at the
  // reading line, refreshed on scroll (one rAF pass) and on resize.
  const syncActiveTurnRef = useRef<() => void>(() => {})
  syncActiveTurnRef.current = () => {
    const local = listRef.current
    const first = turnNavigationItems[0]
    if (local === null || first === undefined) {
      setActiveTurn(null)
      return
    }
    const el = scrollerOf(local)
    const readingLine = el.getBoundingClientRect().top + Math.min(96, el.clientHeight * 0.2)
    const reading = turnAtLine(local, readingLine)
    let next = first.turn
    if (reading !== null) {
      for (const item of turnNavigationItems) {
        if (item.turn > reading) break
        next = item.turn
      }
    }
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1) {
      next = turnNavigationItems.at(-1)?.turn ?? next
    }
    setActiveTurn(current => current === next ? current : next)
  }
  const activeTurnFrameRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (activeTurnFrameRef.current !== null) cancelAnimationFrame(activeTurnFrameRef.current)
    activeTurnFrameRef.current = null
  }, [])
  const scheduleActiveTurn = useCallback((): void => {
    if (activeTurnFrameRef.current !== null) return
    activeTurnFrameRef.current = requestAnimationFrame(() => {
      activeTurnFrameRef.current = null
      syncActiveTurnRef.current()
    })
  }, [])
  useLayoutEffect(() => {
    scheduleActiveTurn()
  }, [scheduleActiveTurn, turnNavigationItems])

  const onScrollRef = useRef(() => {})
  onScrollRef.current = () => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
    if (local === null) return
    const el = scrollerOf(local)
    // Only reader input may make raw scroll geometry change follow ownership:
    // a delivered position that deviates from the observed-top ledger (every
    // programmatic write records itself there synchronously).
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    const movedByReader = Math.abs(el.scrollTop - Math.min(observedTopRef.current, floor)) > 0.5
    const isAtBottom = movedByReader
      ? floor - el.scrollTop <= FOLLOW_THRESHOLD + 1
      : atBottomRef.current
    if (!movedByReader && isAtBottom) {
      toBottom(el)
      return
    }
    atBottomRef.current = isAtBottom
    setAtBottom(isAtBottom)
    const position = isAtBottom ? null : scrollPosition(local, el)
    if (isAtBottom) {
      anchorRef.current = null
    } else if (anchorRef.current !== null && position !== null) {
      anchorRef.current = { key: position.anchorKey, top: position.anchorTop }
    }
    // Continuous save (unmount happens after ref detach, so saving there is
    // too late); pinned-to-bottom clears so a remount keeps following.
    if (isAtBottom) scroll.save(null)
    else if (position !== null) scroll.save(position)
    observedTopRef.current = el.scrollTop
    scheduleActiveTurn()
  }

  // Bind the scroll listener on the resolved scrollport once per mount.
  useEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: effect runs after the list node commits. */
    if (local === null) return
    const el = scrollerOf(local)
    const onScroll = (): void => { onScrollRef.current() }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  // The ref starts null and is assigned every render, so the placeholder
  // initializer a function initial value would need never exists (the chat
  // view's rhythm).
  const followRef = useRef<(() => void) | null>(null)
  followRef.current = () => {
    const local = listRef.current
    if (local !== null && atBottomRef.current) {
      const el = scrollerOf(local)
      el.scrollTop = el.scrollHeight
      observedTopRef.current = el.scrollTop
      scroll.save(null)
    }
  }
  // Streaming, inserted messages, and other flow changes resize the column;
  // the sticky composer resizes outside it. This observer owns the focus
  // view's dynamic-height follow decisions and writes only while the reader
  // is pinned (ChatView's observer, mirrored).
  useEffect(() => {
    const column = columnRef.current
    const local = listRef.current
    if (column === null || local === null || typeof ResizeObserver === 'undefined') return
    const scrollport = scrollerOf(local)
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    // Flow-height changes move rows across the reading line without a scroll
    // event, so the active turn mark resyncs here too.
    const observer = new ResizeObserver(() => {
      followRef.current?.()
      syncActiveTurnRef.current?.()
    })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    return () => { observer.disconnect() }
  }, [])

  /** The fold-stack pager: prepend one older page of turn folds from the
   *  already-fetched index, preserving the settled row the reader anchored
   *  at. No transport rides this click — the index holds every turn. */
  const loadOlderTurnsAnchored = (): void => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the paging button renders inside the list tree. */
    if (local !== null) {
      const el = scrollerOf(local)
      const row = pagingAnchor(local, el)
      if (row !== null && row.dataset.focusAnchorKey !== undefined) {
        anchorRef.current = {
          key: row.dataset.focusAnchorKey,
          top: flowTop(row, el),
        }
      }
    }
    setFoldLimit(limit => limit + FOLD_PAGE)
  }

  /** Jump the focus scrollport to one turn's anchor row (the official rail's
   *  navigation); the reader is no longer pinned to the bottom. */
  const navigateToTurn = useCallback((item: TurnNavigationItem): void => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the rail only renders with the list mounted. */
    if (local === null) return
    const el = scrollerOf(local)
    const row = anchorElement(local, item.anchorKey)
    if (row === null) return
    el.scrollTop += flowTop(row, el) - NAV_JUMP_OFFSET
    observedTopRef.current = el.scrollTop
    atBottomRef.current = false
    setAtBottom(false)
    setActiveTurn(item.turn)
    scroll.save(scrollPosition(local, el))
  }, [scroll])

  // The flow rows' element list, cached on exactly the inputs the rows
  // render from: a parent re-render driven by other state (scroll chrome,
  // live-row clock) reuses the same elements instead of recreating every
  // row's props object.
  const flowRows = useMemo(
    () => flow.map(item => (
      <div
        key={flowKey(item)}
        className={css.flowItem}
        data-focus-anchor-key={flowKey(item)}
        data-focus-turn={flowTurnOf(item, chat) ?? undefined}
      >
        {item.kind === 'remote-turn' ? (
          <RemoteTurnRow
            item={item}
            slice={slicesRef.current.get(item.turn)}
            onExpand={requestTurnSlice}
            t={t}
            mdLabels={mdLabels}
            openFile={requestOpenFile}
            forkAt={forkAt}
            mentionsByKey={mentionsByKey}
            loadImage={loadImage}
            feedback={feedback}
            isLoopback={isLoopback}
            diffStyle={diffStyle}
          />
        ) : (
          <FlowRow
            item={item}
            t={t}
            mdLabels={mdLabels}
            openFile={requestOpenFile}
            forkAt={forkAt}
            mentionsByKey={mentionsByKey}
            loadImage={loadImage}
            feedback={feedback}
            isLoopback={isLoopback}
            diffStyle={diffStyle}
          />
        )}
      </div>
    )),
    [flow, chat, t, mdLabels, requestOpenFile, forkAt, mentionsByKey, loadImage, feedback, isLoopback, diffStyle, requestTurnSlice],
  )

  return (
    <div className={css.root} data-focus-md-style={mdStyle}>
      <div ref={navigatorMetricsRef} className={css.scroll} data-focus-scroll="">
        {/* The official turn navigator floats over the transcript's right
            gutter (pure CSS positioning, no measuring). */}
        <TurnNavigator items={turnNavigationItems} activeTurn={activeTurn} onNavigate={navigateToTurn} t={t} />
        <div ref={columnRef} className={css.column} data-focus-flow="">
        {openState === 'loading' && <div className={css.hint}>{t('loadingHistory')}</div>}
        {openState === 'error' && openError !== null && (
          <div className={css.openError}>
            {t('loadError', { message: openError.message, code: openError.code })}
          </div>
        )}
        {/* The fold-stack pager: older turns sit behind it as folds of the
            already-fetched index — the raw-message pager is gone, a turn's
            process detail loads when its fold expands. */}
        {preHeadTurns.length > remoteTurns.length && (
          <div className={css.older}>
            <button type="button" className={css.olderButton} onClick={loadOlderTurnsAnchored}>
              {t('loadOlderTurns')}
            </button>
          </div>
        )}
        {flow.length === 0 && <div className={css.empty}>{t('empty')}</div>}
        {flowRows}
        {/* The running call renders below everything settled — the model's
            output text included — and folds into its group's summary line
            once the call settles (no flow rebuild, no row jump). */}
        {runningCalls.length > 0 && (
          <div className={css.flowItem}>
            <div className={css.runningCalls} data-running-calls>
              {runningCalls.map(row => (
                <ToolCallRow key={row.callId} row={row} t={t} openFile={requestOpenFile} />
              ))}
            </div>
          </div>
        )}
        {running && <RunningStatus startTime={runningTurnStart} t={t} />}
        {pendingSteering.map(item => (
          <PendingSteeringBubble key={item.id} content={item.content} t={t} loadImage={loadImage} />
        ))}
        {!atBottom && (
          <div className={css.toBottomSlot}>
            <button
              type="button"
              className={css.toBottom}
              aria-label={t('toBottom')}
              onClick={() => {
                const local = listRef.current
                /* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
                if (local !== null) toBottom(scrollerOf(local))
              }}
            >
              <IconChevronDownOutline14 />
            </button>
          </div>
        )}
        </div>
      </div>
      {fileOpenError !== null && (
        <FileOpenErrorDialog
          path={fileOpenError.path}
          message={fileOpenError.message}
          busy={fileOpenBusy}
          onClose={closeFileOpenError}
          onRetry={() => { requestOpenFile(fileOpenError.path) }}
          t={t}
        />
      )}
    </div>
  )
}
