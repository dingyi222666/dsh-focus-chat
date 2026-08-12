import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownCodeLabels, MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { FocusScrollPosition, FocusViewProps } from '../contract/props.ts'
import { buildFocusFlow } from '../model/index.ts'
import type { FocusFlowItem, FocusToolRow } from '../model/index.ts'
import { FlowRow, flowKey } from './rows/FlowRow.tsx'
import { PendingSteeringBubble } from './rows/UserBubble.tsx'
import { ToolCallRow } from './rows/ToolCallRow.tsx'
import { RunningStatus } from './chrome/RunningStatus.tsx'
import css from './FocusView.module.css'

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

/** Active conversation column host when present; otherwise the view-local scroller. */
function scrollerOf(from: HTMLElement): HTMLElement {
  return from.closest('[data-conversation-scroll]') ?? from
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

/**
 * The focus view slot entry: pure component over the composed props. Scroll
 * follows the chat view's ledger: the resolved scrollport (the shared
 * conversation column in the app, the view itself in tests) keeps reader
 * positions saved continuously on scroll and restored on mount.
 * @param props - conversation view standard kit and the focus locale seat.
 */

export function FocusView({
  useSession, sessionId, useSessions, loadOlder, loadImage, openFile, forkAt, fileMentions,
  isLoopback, useHostDescription, scroll, t,
}: FocusViewProps) {
  // Subscribing to the whole chat snapshot (not the order/nodes handles) keeps
  // the flow fresh on every publication — including assistant-only updates
  // that leave the order array untouched, which is what folds a finished
  // Think row back in.
  const chat = useSession(s => s.chat)
  const running = useSession(s => s.running)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)
  const inbox = useSession(s => s.queue)
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const flow = useMemo(
    () => buildFocusFlow(chat.order, key => chat.nodes.get(key), cwd),
    [chat, cwd],
  )
  // The current step's running calls: live rows at the END of the flow —
  // below the model's output text — that fold into their group's summary
  // line once settled (the chat live row's position, the think lifecycle).
  const runningCalls = useMemo(() => {
    const rows: FocusToolRow[] = []
    for (const item of flow) {
      if (item.kind !== 'tools' || !item.group.running) continue
      for (const row of item.group.items) {
        if ('callId' in row && row.state === 'running') rows.push(row)
      }
    }
    return rows
  }, [flow])
  const runningTurnStart = useMemo(() => runningTurnStartTime(chat.timeline), [chat.timeline])
  const codeLabels = useMemo<MarkdownCodeLabels>(
    () => ({ copyLabel: t('copy'), copiedLabel: t('copied') }),
    [t],
  )
  const pendingSteering = useMemo(
    () => inbox.filter(item => item.placement === 'steering'),
    [inbox],
  )
  // Inline file-mention vocabulary for closing assistants: the engine turn
  // data names the closing seq, the optional chatFileMentions service
  // resolves its prose tokens (absent service leaves the prose inert).
  const mentionsByKey = useMemo(() => {
    const map = new Map<string, MarkdownFileMentions | undefined>()
    for (const item of flow) {
      if (item.kind !== 'assistant' || item.finalSeq === null) continue
      const location = chat.nodes.get(item.nodeKey)?.location
      const turn = location?.kind === 'turn' || location?.kind === 'step' ? location.turn : undefined
      const tail = turn?.data.get('turn-tail')
      if (turn === undefined || tail?.closing?.finalNode.seq !== item.finalSeq) continue
      map.set(item.nodeKey, fileMentions({ turn, seq: item.finalSeq, openFile }))
    }
    return map
  }, [chat, fileMentions, flow, openFile])

  const listRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
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
  const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null
  const followSig = `${openState}:${firstKey}:${lastKey}:${flow.length}:${running ? 1 : 0}:${lastSteeringId ?? ''}`

  const toBottom = (el: HTMLElement): void => {
    anchorRef.current = null
    el.scrollTop = el.scrollHeight
    observedTopRef.current = el.scrollTop
    atBottomRef.current = true
    setAtBottom(true)
    scroll.save(null)
  }

  useLayoutEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
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
    const observer = new ResizeObserver(() => { followRef.current?.() })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    return () => { observer.disconnect() }
  }, [])

  const loadOlderAnchored = (): void => {
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
    loadOlder()
  }

  return (
    <div className={css.root}>
      <div ref={listRef} className={css.scroll} data-focus-scroll="">
        <div ref={columnRef} className={css.column} data-focus-flow="">
        {openState === 'loading' && <div className={css.hint}>{t('loadingHistory')}</div>}
        {openState === 'error' && openError !== null && (
          <div className={css.openError}>
            {t('loadError', { message: openError.message, code: openError.code })}
          </div>
        )}
        {hasMore && (
          <div className={css.older}>
            <button type="button" className={css.olderButton} disabled={loadingOlder} onClick={loadOlderAnchored}>
              {loadingOlder ? t('loading') : t('loadOlder')}
            </button>
          </div>
        )}
        {flow.length === 0 && <div className={css.empty}>{t('empty')}</div>}
        {flow.map(item => (
          <div key={flowKey(item)} className={css.flowItem} data-focus-anchor-key={flowKey(item)}>
            <FlowRow
              item={item}
              t={t}
              codeLabels={codeLabels}
              openFile={openFile}
              forkAt={forkAt}
              mentionsByKey={mentionsByKey}
              loadImage={loadImage}
              isLoopback={isLoopback}
              useHostDescription={useHostDescription}
            />
          </div>
        ))}
        {/* The running call renders below everything settled — the model's
            output text included — and folds into its group's summary line
            once the call settles (no flow rebuild, no row jump). */}
        {runningCalls.length > 0 && (
          <div className={css.flowItem}>
            <div className={css.runningCalls} data-running-calls>
              {runningCalls.map(row => (
                <ToolCallRow key={row.callId} row={row} t={t} openFile={openFile} />
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
    </div>
  )
}
