import {
  memo, useEffect, useId, useRef, useState,
  type CSSProperties, type MouseEvent, type PointerEvent,
} from 'react'
import type { FocusTranslate } from '../../contract/props.ts'
import css from './TurnNavigator.module.css'

/**
 * One rail mark: a loaded Turn scrolls to its row; an unloaded one (its fold
 * still behind the pager) pages older folds in first, then jumps — the
 * alpha.5 chat rail's loaded/unloaded anchor union, reimplemented over the
 * focus view's own fold stack.
 */
export interface FocusTurnRailItem {
  readonly turn: number
  /** Bounded prompt preview (loaded window first, index fallback). */
  readonly prompt: string
  /** Bounded response preview (loaded window first, index fallback). */
  readonly response: string
  /** How the rail reaches the Turn. */
  readonly anchor:
    | { readonly kind: 'loaded'; readonly key: string }
    | { readonly kind: 'unloaded' }
}

interface TurnNavigatorProps {
  readonly items: readonly FocusTurnRailItem[]
  readonly activeTurn: number | null
  /** Turn whose jump is still paging folds in; its mark pulses. */
  readonly busyTurn: number | null
  readonly onNavigate: (item: FocusTurnRailItem) => void
  readonly t: FocusTranslate
}

/** Fixed pitch between neighbouring marks; overflow scrolls inside the frame. */
const TURN_SPACING_PX = 10
/** Rail padding above the first mark and below the last one, per end. */
const RAIL_INSET_PX = 6
/** Fade band the mask reserves at a scrollable end. */
const FADE_PX = 24

type TurnPositionStyle = CSSProperties & {
  readonly '--turn-natural-position': string
}

type TurnFrameStyle = CSSProperties & {
  readonly '--turn-natural-height': string
  readonly '--turn-rail-inset': string
  readonly '--turn-scroll-top': string
}

function itemPosition(index: number): TurnPositionStyle {
  return { '--turn-natural-position': `${String(index * TURN_SPACING_PX)}px` }
}

function frameStyle(count: number, scrollTop: number): TurnFrameStyle {
  return {
    '--turn-natural-height': `${String((count - 1) * TURN_SPACING_PX + 2 * RAIL_INSET_PX)}px`,
    '--turn-rail-inset': `${String(RAIL_INSET_PX)}px`,
    '--turn-scroll-top': `${String(scrollTop)}px`,
  }
}

function itemAtPointer(
  items: readonly FocusTurnRailItem[],
  frame: HTMLElement,
  scrollTop: number,
  clientY: number,
): FocusTurnRailItem | undefined {
  const rect = frame.getBoundingClientRect()
  const offset = clientY - rect.top + scrollTop - RAIL_INSET_PX
  const index = Math.max(0, Math.min(items.length - 1, Math.round(offset / TURN_SPACING_PX)))
  return items[index]
}

/** Scroll state the mask fades and follow logic read together. */
interface RailScrollState {
  readonly top: number
  readonly canScrollUp: boolean
  readonly canScrollDown: boolean
}

const RAIL_AT_REST: RailScrollState = { top: 0, canScrollUp: false, canScrollDown: false }

function railScrollState(scroller: HTMLElement): RailScrollState {
  const top = scroller.scrollTop
  return {
    top,
    canScrollUp: top > 1,
    canScrollDown: top < scroller.scrollHeight - scroller.clientHeight - 1,
  }
}

function sameRailScrollState(left: RailScrollState, right: RailScrollState): boolean {
  return left.top === right.top
    && left.canScrollUp === right.canScrollUp
    && left.canScrollDown === right.canScrollDown
}

/** Fixed-pitch rail of the focus view's known Turns — loaded marks scroll to
 *  their rows, unloaded ones page their fold in first — with hover and focus
 *  previews. Overflow scrolls inside the frame, gradient fades marking each
 *  scrollable end, the active mark keeps itself in view while the pointer is
 *  elsewhere, and a jump still paging folds in pulses its mark. */
export const TurnNavigator = memo(function TurnNavigator({ items, activeTurn, busyTurn, onNavigate, t }: TurnNavigatorProps) {
  const [previewTurn, setPreviewTurn] = useState<number | null>(null)
  const [scrollState, setScrollState] = useState<RailScrollState>(RAIL_AT_REST)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  /** While the pointer works the rail, follow must not move it under the hand. */
  const pointerInsideRef = useRef(false)
  const previewId = useId()

  const syncScrollState = (): void => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const next = railScrollState(scroller)
    setScrollState(current => sameRailScrollState(current, next) ? current : next)
  }

  // Frame resizes (band/composer changes) move the overflow edges without a
  // scroll event; item count changes move the content height the same way.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncScrollState)
    observer.observe(scroller)
    return () => { observer.disconnect() }
  }, [])
  useEffect(syncScrollState, [items.length])

  // Keep the active mark visible: centre it whenever it leaves the scrollport,
  // unless the reader's pointer is working the rail.
  useEffect(() => {
    const scroller = scrollerRef.current
    const index = items.findIndex(item => item.turn === activeTurn)
    if (scroller === null || index < 0 || pointerInsideRef.current) return
    const markTop = index * TURN_SPACING_PX + RAIL_INSET_PX
    const viewTop = scroller.scrollTop
    const viewHeight = scroller.clientHeight
    if (viewHeight <= 0 || (markTop >= viewTop + FADE_PX && markTop <= viewTop + viewHeight - FADE_PX)) return
    const target = Math.max(0, markTop - viewHeight / 2)
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top: target, behavior: reduced ? 'auto' : 'smooth' })
    } else {
      scroller.scrollTop = target
    }
    syncScrollState()
  }, [activeTurn, items])

  if (items.length < 2) return null
  const previewIndex = items.findIndex(item => item.turn === previewTurn)
  const preview = previewIndex < 0 ? undefined : items[previewIndex]
  const previewPosition = previewIndex < 0 ? undefined : itemPosition(previewIndex)
  const previewAtPointer = (event: PointerEvent<HTMLElement>): void => {
    const scrollTop = scrollerRef.current?.scrollTop ?? 0
    setPreviewTurn(itemAtPointer(items, event.currentTarget, scrollTop, event.clientY)?.turn ?? null)
  }
  const navigateAtPointer = (event: MouseEvent<HTMLElement>): void => {
    const scrollTop = scrollerRef.current?.scrollTop ?? 0
    const item = itemAtPointer(items, event.currentTarget, scrollTop, event.clientY)
    if (item !== undefined) onNavigate(item)
  }
  const fadeClasses = [css.scroller]
  if (scrollState.canScrollUp) fadeClasses.push(css.fadeTop)
  if (scrollState.canScrollDown) fadeClasses.push(css.fadeBottom)
  return (
    <div className={css.slot}>
      <nav
        className={css.frame}
        style={frameStyle(items.length, scrollState.top)}
        aria-label={t('turnNavigation.label')}
        onClick={navigateAtPointer}
        onPointerMove={previewAtPointer}
        onPointerEnter={() => { pointerInsideRef.current = true }}
        onPointerLeave={() => {
          pointerInsideRef.current = false
          setPreviewTurn(null)
        }}
      >
        <div
          ref={scrollerRef}
          className={fadeClasses.join(' ')}
          onScroll={() => { syncScrollState() }}
        >
          <div className={css.marks}>
            {items.map((item, index) => {
              const active = item.turn === activeTurn
              const showingPreview = item.turn === previewTurn
              const classes = [css.mark]
              if (item.anchor.kind === 'unloaded') classes.push(css.markUnloaded)
              if (active) classes.push(css.markActive)
              else if (showingPreview) classes.push(css.markPreview)
              if (item.turn === busyTurn) classes.push(css.markBusy)
              return (
                <div key={item.turn} className={css.markPosition} style={itemPosition(index)}>
                  <button
                    type="button"
                    className={classes.join(' ')}
                    aria-label={t(
                      item.anchor.kind === 'loaded' ? 'turnNavigation.jump' : 'turnNavigation.jumpLoad',
                      { turn: item.turn },
                    )}
                    aria-current={active ? 'true' : undefined}
                    aria-busy={item.turn === busyTurn ? 'true' : undefined}
                    aria-describedby={showingPreview ? previewId : undefined}
                    onClick={(event) => {
                      event.stopPropagation()
                      onNavigate(item)
                    }}
                    onFocus={() => { setPreviewTurn(item.turn) }}
                    onBlur={() => { setPreviewTurn(null) }}
                  />
                </div>
              )
            })}
          </div>
        </div>
        {preview !== undefined && previewPosition !== undefined && (
          <div id={previewId} role="tooltip" className={css.preview} style={previewPosition}>
            <div className={css.previewPrompt}>
              {preview.prompt || t('turnNavigation.turn', { turn: preview.turn })}
            </div>
            {preview.response !== '' && <div className={css.previewResponse}>{preview.response}</div>}
          </div>
        )}
      </nav>
    </div>
  )
})
