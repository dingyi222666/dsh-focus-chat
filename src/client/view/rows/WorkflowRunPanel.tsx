import {
  useLayoutEffect, useMemo, useRef, useState,
  type FocusEvent, type MouseEvent, type ReactNode,
} from 'react'
import {
  DisclosureRow, IconChevronRightOutline14, StateDot,
  type DisclosureRowProps, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FocusTranslate } from '../../contract/props.ts'
import type {
  FocusFlowItem, WorkflowRunMemberData, WorkflowRunPhaseData, WorkflowRunStatus,
} from '../../model/types.ts'
import css from './WorkflowRunPanel.module.css'

/** Complete props of one workflow-run row. */
export interface WorkflowRunPanelProps {
  readonly item: Extract<FocusFlowItem, { kind: 'workflow-run' }>
  /** The owning Session: only its own running subagents are navigable. */
  readonly sessionId: string
  /** Session list snapshot selector (the standard kit). */
  readonly useSessions: WorkflowRunSessionsHook
  /** Open one member's child Session (the plugin's own Session Controller access). */
  readonly openSession: (sessionId: string) => void
  readonly t: FocusTranslate
}

/** The slice of the standard kit's useSessions this row reads. */
export type WorkflowRunSessionsHook = <S>(
  selector: (sessions: SessionListState) => S,
  eq?: (left: S, right: S) => boolean,
) => S

const STATUS_KEYS = {
  running: 'workflow.status.running',
  completed: 'workflow.status.completed',
  failed: 'workflow.status.failed',
  cancelled: 'workflow.status.cancelled',
  interrupted: 'workflow.status.interrupted',
} as const satisfies Record<WorkflowRunStatus, string>

function dotState(status: WorkflowRunStatus): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'completed': return 'done'
    case 'failed': return 'error'
    case 'cancelled':
    case 'interrupted': return 'warning'
  }
}

function readablePhase(phase: string | null, t: FocusTranslate): string {
  if (phase === null) return t('workflow.phase.unassigned')
  return phase === '' ? t('workflow.phase.empty') : phase
}

function readableMember(label: string, t: FocusTranslate): string {
  return label === '' ? t('workflow.member.empty') : label
}

function statusCount(status: WorkflowRunStatus, count: number, t: FocusTranslate): string {
  return t(`workflow.statusCount.${status}` as 'workflow.statusCount.running', { count })
}

function memberCount(count: number, t: FocusTranslate): string {
  return t(count === 1 ? 'workflow.members.one' : 'workflow.members.other', { count })
}

type DisclosureMode = 'clean' | 'running' | 'abnormal'

interface DisclosureFacts {
  readonly mode: DisclosureMode
  readonly activityCount: number
}

interface DisclosureState extends DisclosureFacts {
  readonly open: boolean
  readonly pendingCleanCollapse: boolean
}

interface WorkflowDisclosureState {
  readonly run: DisclosureState
  readonly phases: ReadonlyMap<string, DisclosureState>
}

type StatusDisclosureProps = Omit<DisclosureRowProps, 'expandable'>

function StatusDisclosure(props: StatusDisclosureProps) {
  return <DisclosureRow {...props} expandable />
}

function abnormal(status: WorkflowRunStatus): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'interrupted'
}

function phaseDisclosureFacts(phase: WorkflowRunPhaseData): DisclosureFacts {
  const mode = phase.members.some(member => abnormal(member.status))
    ? 'abnormal'
    : phase.members.some(member => member.status === 'running') ? 'running' : 'clean'
  return { mode, activityCount: phase.members.length }
}

function runDisclosureFacts(
  status: WorkflowRunStatus,
  phases: readonly (readonly [string, DisclosureFacts])[],
): DisclosureFacts {
  const mode = abnormal(status) || phases.some(([, facts]) => facts.mode === 'abnormal')
    ? 'abnormal'
    : status === 'running' || phases.some(([, facts]) => facts.mode === 'running')
      ? 'running'
      : 'clean'
  const activityCount = phases.reduce((count, [, facts]) => count + facts.activityCount, 0)
  return { mode, activityCount }
}

function initialDisclosureState(facts: DisclosureFacts): DisclosureState {
  return { ...facts, open: facts.mode !== 'clean', pendingCleanCollapse: false }
}

function advanceDisclosureState(
  current: DisclosureState,
  facts: DisclosureFacts,
  focusWithin: boolean,
): DisclosureState {
  const sameFacts = current.mode === facts.mode && current.activityCount === facts.activityCount
  if (sameFacts) {
    if (!current.pendingCleanCollapse || focusWithin) return current
    return { ...current, open: false, pendingCleanCollapse: false }
  }
  if (facts.mode === 'clean') {
    const deferCollapse = current.open && focusWithin
    return { ...facts, open: deferCollapse, pendingCleanCollapse: deferCollapse }
  }
  if (current.mode === 'clean' || (facts.mode === 'abnormal' && current.mode !== 'abnormal')) {
    return { ...facts, open: true, pendingCleanCollapse: false }
  }
  return { ...facts, open: current.open, pendingCleanCollapse: false }
}

function focusIsWithin(element: HTMLElement | null | undefined): boolean {
  if (element === null || element === undefined) return false
  return element.contains(element.ownerDocument.activeElement)
}

function collapsePending(state: DisclosureState): DisclosureState {
  if (!state.pendingCleanCollapse) return state
  return { ...state, open: false, pendingCleanCollapse: false }
}

function existingPhaseState(
  phases: ReadonlyMap<string, DisclosureState>,
  key: string,
): DisclosureState {
  const phase = phases.get(key)
  /* v8 ignore next -- mounted phase callbacks are created from this owner map. */
  if (phase === undefined) throw new Error(`Missing disclosure state for phase ${key}`)
  return phase
}

function preventPendingHeaderFocus(event: MouseEvent<HTMLElement>): void {
  const header = event.currentTarget.querySelector('[data-disclosure-row]')
  /* v8 ignore next -- DisclosureRow always renders its header before the content. */
  if (header === null) throw new Error('Missing disclosure header')
  if (header.contains(event.target as Node)) event.preventDefault()
}

function phaseStatusSummary(members: readonly WorkflowRunMemberData[], t: FocusTranslate): string {
  const counts = new Map<WorkflowRunStatus, number>()
  for (const member of members) counts.set(member.status, (counts.get(member.status) ?? 0) + 1)
  const count = (status: WorkflowRunStatus): number => counts.get(status) ?? 0
  const active = (['running', 'failed', 'cancelled', 'interrupted'] as const)
    .filter(status => count(status) > 0)
  if (active.length === 0) return statusCount('completed', count('completed'), t)
  const visible = active.includes('interrupted') && count('completed') > 0
    ? ['completed' as const, ...active]
    : active
  return visible.map(status => statusCount(status, count(status), t)).join(' · ')
}

/** Identity comparison for the navigable-id list the selector returns. */
function sameIds(left: readonly SessionId[], right: readonly SessionId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function navigableMembers(
  sessions: SessionListState,
  phases: readonly WorkflowRunPhaseData[],
  parentId: string,
): readonly SessionId[] {
  const ordinary = new Set<string>(sessions.ids)
  const result: SessionId[] = []
  for (const phase of phases) {
    for (const member of phase.members) {
      const childId = member.childId as SessionId
      const summary = sessions.byId[childId]
      if (member.status === 'running'
        && ordinary.has(member.childId)
        && summary?.origin === 'subagent'
        && summary.parentId === parentId
        && summary.running) {
        result.push(childId)
      }
    }
  }
  return result
}

function RunHeader({ children, count, name, onToggle, open, status, t }: {
  readonly children: ReactNode
  readonly count: number
  readonly name: string
  readonly onToggle: () => void
  readonly open: boolean
  readonly status: WorkflowRunStatus
  readonly t: FocusTranslate
}) {
  return (
    <StatusDisclosure
      icon={<IconChevronRightOutline14 />}
      title={t('workflow.run.title', { name })}
      open={open}
      onToggle={onToggle}
      expandOnRowClick
      previewChevron={false}
      keepContentWhenOpen
      rowClassName={css.runHeader}
      leadingClassName={css.runLeading}
      titleClassName={css.runTitle}
      collapsedContent={(
        <>
          <span className={css.separator} aria-hidden />
          <span className={css.runSummary}>{memberCount(count, t)}</span>
          <span className={css.statusTail} data-status={status}>
            <StateDot state={dotState(status)} />
            <span>{t(STATUS_KEYS[status] as 'workflow.status.running')}</span>
          </span>
        </>
      )}
    >
      {children}
    </StatusDisclosure>
  )
}

function MemberRow({ member, navigable, openSession, t }: {
  readonly member: WorkflowRunMemberData
  readonly navigable: boolean
  readonly openSession: (sessionId: string) => void
  readonly t: FocusTranslate
}) {
  const name = readableMember(member.label, t)
  const [focused, setFocused] = useState(false)
  const renderButton = navigable || focused

  const content = (
    <>
      <span className={css.dotSlot}><StateDot state={dotState(member.status)} /></span>
      <span className={css.memberLabelWrap} data-member-label-wrap>
        <span className={css.memberLabel} data-member-label>{name}</span>
      </span>
      <span className={css.memberStatus} data-member-status-text>
        {t(STATUS_KEYS[member.status] as 'workflow.status.running')}
      </span>
    </>
  )
  if (!renderButton) {
    return <div className={css.memberRow} data-member-status={member.status}>{content}</div>
  }
  return (
    <button
      type="button"
      className={navigable ? css.memberButton : css.memberRow}
      data-member-status={member.status}
      aria-disabled={navigable ? undefined : true}
      aria-label={navigable ? t('workflow.member.open', { name }) : name}
      tabIndex={navigable ? undefined : -1}
      onFocus={() => { setFocused(true) }}
      onBlur={() => { setFocused(false) }}
      onClick={navigable ? () => { openSession(member.childId) } : undefined}
    >
      {content}
    </button>
  )
}

function PhaseSection({
  contentRef, onContentBlur, onToggle, open, pendingCleanCollapse,
  phase, navigable, openSession, t,
}: {
  readonly contentRef: (element: HTMLDivElement | null) => void
  readonly onContentBlur: (event: FocusEvent<HTMLDivElement>) => void
  readonly onToggle: () => void
  readonly open: boolean
  readonly pendingCleanCollapse: boolean
  readonly phase: WorkflowRunPhaseData
  readonly navigable: readonly string[]
  readonly openSession: (sessionId: string) => void
  readonly t: FocusTranslate
}) {
  return (
    <div
      className={css.phase}
      onMouseDownCapture={pendingCleanCollapse ? preventPendingHeaderFocus : undefined}
    >
      <StatusDisclosure
        icon={<IconChevronRightOutline14 />}
        title={readablePhase(phase.phase, t)}
        open={open}
        onToggle={onToggle}
        expandOnRowClick
        previewChevron={false}
        keepContentWhenOpen
        rowClassName={css.phaseHeader}
        leadingClassName={css.phaseLeading}
        titleClassName={css.phaseTitle}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.phaseCount} data-phase-count>{memberCount(phase.members.length, t)}</span>
            <span className={css.phaseStatus} data-phase-status-text>{phaseStatusSummary(phase.members, t)}</span>
          </>
        )}
      >
        <div ref={contentRef} className={css.members} onBlur={onContentBlur}>
          {phase.members.map(member => (
            <MemberRow
              key={member.seq}
              member={member}
              navigable={navigable.includes(member.childId)}
              openSession={openSession}
              t={t}
            />
          ))}
        </div>
      </StatusDisclosure>
    </div>
  )
}

/**
 * One durable workflow run (the chat workflow-run node): the run header with
 * its member count and status, and one disclosure per phase. Status drives the
 * disclosures — an active run opens itself, and a run that settles while focus
 * is inside defers its collapse until the reader leaves.
 */
export function WorkflowRunPanel({ item, sessionId, useSessions, openSession, t }: WorkflowRunPanelProps) {
  const phaseFacts = useMemo(() => item.data.phases.map(phase => (
    [phase.key, phaseDisclosureFacts(phase)] as const
  )), [item.data.phases])
  const runFacts = useMemo(
    () => runDisclosureFacts(item.data.status, phaseFacts),
    [item.data.status, phaseFacts],
  )
  const totalMembers = runFacts.activityCount
  const [disclosures, setDisclosures] = useState<WorkflowDisclosureState>(() => ({
    run: initialDisclosureState(runFacts),
    phases: new Map(phaseFacts.map(([key, facts]) => [key, initialDisclosureState(facts)])),
  }))
  const runContentRef = useRef<HTMLDivElement>(null)
  const phaseContentRefs = useRef(new Map<string, HTMLDivElement>())
  const navigable = useSessions(
    sessions => navigableMembers(sessions, item.data.phases, sessionId),
    sameIds,
  )

  // Outer hiding unmounts phase content without a dependable blur event, so
  // this edge settles deferred closes.
  useLayoutEffect(() => {
    setDisclosures((current) => {
      const phases = new Map<string, DisclosureState>()
      let phasesChanged = current.phases.size !== phaseFacts.length
      let phaseStartedCycle = false
      for (const [key, facts] of phaseFacts) {
        const previous = current.phases.get(key)
        const next = previous === undefined
          ? initialDisclosureState(facts)
          : advanceDisclosureState(previous, facts, focusIsWithin(phaseContentRefs.current.get(key)))
        phases.set(key, next)
        if (next !== previous) phasesChanged = true
        if (previous?.mode === 'clean'
          && (facts.mode !== 'clean' || facts.activityCount !== previous.activityCount)) {
          phaseStartedCycle = true
        }
      }
      const advancedRun = advanceDisclosureState(
        current.run,
        runFacts,
        focusIsWithin(runContentRef.current),
      )
      const run = phaseStartedCycle && runFacts.mode !== 'clean' && !advancedRun.open
        ? { ...advancedRun, open: true, pendingCleanCollapse: false }
        : advancedRun
      return run !== current.run || phasesChanged ? { run, phases } : current
    })
  }, [disclosures.run.open, phaseFacts, runFacts])

  const toggleRun = (): void => {
    setDisclosures(current => ({
      ...current,
      run: {
        ...current.run,
        open: !current.run.open,
        pendingCleanCollapse: false,
      },
    }))
  }
  const togglePhase = (key: string): void => {
    setDisclosures((current) => {
      const phases = new Map(current.phases)
      const phase = existingPhaseState(phases, key)
      phases.set(key, {
        ...phase,
        open: !phase.open,
        pendingCleanCollapse: false,
      })
      return { ...current, phases }
    })
  }
  const settleRunBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDisclosures((current) => {
      const run = collapsePending(current.run)
      return run === current.run ? current : { ...current, run }
    })
  }
  const settlePhaseBlur = (key: string, event: FocusEvent<HTMLDivElement>): void => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDisclosures((current) => {
      const phase = existingPhaseState(current.phases, key)
      const next = collapsePending(phase)
      if (next === phase) return current
      const phases = new Map(current.phases)
      phases.set(key, next)
      return { ...current, phases }
    })
  }

  return (
    <section
      className={css.root}
      data-workflow-run
      data-run-status={item.data.status}
      onMouseDownCapture={disclosures.run.pendingCleanCollapse
        ? preventPendingHeaderFocus
        : undefined}
    >
      <RunHeader
        count={totalMembers}
        name={item.data.name}
        open={disclosures.run.open}
        onToggle={toggleRun}
        status={item.data.status}
        t={t}
      >
        <div ref={runContentRef} className={css.phaseList} onBlur={settleRunBlur}>
          {item.data.phases.length === 0
            ? <span className={css.empty}>{t('workflow.run.empty')}</span>
            : item.data.phases.map((phase) => {
              const facts = phaseDisclosureFacts(phase)
              const disclosure = disclosures.phases.get(phase.key) ?? initialDisclosureState(facts)
              return (
                <PhaseSection
                  key={phase.key}
                  contentRef={(element) => {
                    if (element === null) phaseContentRefs.current.delete(phase.key)
                    else phaseContentRefs.current.set(phase.key, element)
                  }}
                  onContentBlur={(event) => { settlePhaseBlur(phase.key, event) }}
                  onToggle={() => { togglePhase(phase.key) }}
                  open={disclosure.open}
                  pendingCleanCollapse={disclosure.pendingCleanCollapse}
                  phase={phase}
                  navigable={navigable}
                  openSession={openSession}
                  t={t}
                />
              )
            })}
        </div>
      </RunHeader>
    </section>
  )
}
