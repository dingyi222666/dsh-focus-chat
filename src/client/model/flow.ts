/** One condensed flow over the chat snapshot (React-free). */
import type { AssistantChatData, ChatNodeDataMap, ManualCompactionChatData, ToolChatData, TurnTailChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AssistantBlock, ChatConversationViewNode, CommandNode, CompactionSummaryNode, ContextMessageNode, SteeringMessageNode, ToolCallBlock, TurnErrorNode, UserMessageNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { toolGroup, type ToolRowModelCache } from './tools.ts'
import { assistantText, producedForClosing, thoughtDurationMs } from './text.ts'
import type { FocusContextItem, FocusFlowItem, FocusGroupThink, FocusNodeData, FocusToolGroup } from './types.ts'

/**
 * One derived flow item plus the identity facts it was derived from. The
 * signature holds node/data references only — O(1) per node per rebuild —
 * so an unchanged node reuses its previous item object and memoized rows
 * never re-render while the rest of the conversation streams.
 */
interface CachedFlowItem {
  readonly signature: unknown
  readonly item: FocusFlowItem | null
}

/**
 * Cross-build cache for the focus flow derivation: per-node derived items,
 * the tool-row models the groups fold, and whole tool-group rows. Keyed by
 * stable node/call ids, holding only immutable snapshot references, so it
 * never grows beyond the conversation and is discarded with the view.
 */
export interface FlowBuildCache {
  readonly items: Map<string, CachedFlowItem>
  readonly rows: ToolRowModelCache['rows']
  /** One emitted tool-group row per run (its node keys), valid while the
   *  run's blocks keep their references and the group absorbed no context
   *  batch (an absorption changes the group's shape). */
  readonly groups: Map<string, { blocks: readonly ToolCallBlock[]; item: FocusFlowItem }>
}

/** One cache instance per mounted focus view (the build is React-free). */
export function createFlowBuildCache(): FlowBuildCache {
  return { items: new Map(), rows: new Map(), groups: new Map() }
}

/** The node facts a cached item's validity depends on. */
function nodeSignature(node: ChatConversationViewNode): unknown {
  if (node.kind === 'tool-call') return node.data
  if (node.kind === 'turn-tail') {
    const tail = node.data as TurnTailChatData
    return [node.data, tail.closing?.finalNode, tail.closing?.time]
  }
  return node.data
}

/** The cached flow item for one node, or a fresh derivation when the node
 *  moved on (a new node reference or a mutated data reference). */
function flowItemCached(
  cache: FlowBuildCache | undefined,
  key: string,
  node: ChatConversationViewNode,
  data: FocusNodeData,
): FocusFlowItem | null {
  if (cache === undefined) return flowItemOf(key, node, data)
  const previous = cache.items.get(key)
  const signature = nodeSignature(node)
  if (previous !== undefined && previous.signature === signature) return previous.item
  const item = flowItemOf(key, node, data)
  cache.items.set(key, { signature, item })
  return item
}

function flowItemOf(
  key: string,
  node: ChatConversationViewNode,
  data: FocusNodeData,
): FocusFlowItem | null {
  switch (node.kind) {
    case 'user':
    case 'steering':
    case 'context': {
      const message = data as UserMessageNode | SteeringMessageNode | ContextMessageNode
      const base = {
        kind: 'message' as const,
        nodeKey: key,
        role: node.kind,
        content: message.content,
        time: message.time,
      }
      if (node.kind !== 'context') return base
      const context = message as ContextMessageNode
      return {
        ...base,
        context: { source: context.source, provenance: context.provenance, form: context.form },
      }
    }
    case 'assistant-step': {
      const assistant = data as AssistantChatData
      return {
        kind: 'assistant',
        nodeKey: key,
        blocks: assistant.blocks,
        running: assistant.status === 'running',
        interrupted: assistant.status === 'interrupted',
        thoughtMs: thoughtDurationMs(assistant),
        finalSeq: assistant.finalNode?.seq ?? null,
      }
    }
    /* v8 ignore next 2 -- unreachable: buildFocusFlow folds tool-call nodes before flowItemOf dispatch */
    case 'tool-call':
      return null // folded by the group pass; see buildFocusFlow
    case 'command': {
      const command = data as CommandNode
      const outcome = command.outcome
      return {
        kind: 'command',
        nodeKey: key,
        name: command.name,
        args: command.args,
        outcomeText: outcome === null ? null : outcome.text ?? null,
        outcomeError: outcome !== null && outcome.kind === 'error',
        running: outcome === null,
      }
    }
    case 'manual-compaction': {
      const manual = data as ManualCompactionChatData
      const command = manual.command
      const outcome = command.outcome
      return {
        kind: 'manual-compaction',
        nodeKey: key,
        name: command.name,
        outcomeText: outcome === null ? null : outcome.text ?? null,
        outcomeError: outcome !== null && outcome.kind === 'error',
        running: outcome === null,
        compaction: manual.compaction === null ? null : {
          summary: manual.compaction.summary,
          shadowedItemCount: manual.compaction.shadowedItemCount,
          shadowedTokenCount: manual.compaction.shadowedTokenCount,
        },
      }
    }
    case 'compaction': {
      const compaction = data as CompactionSummaryNode
      return {
        kind: 'compaction',
        nodeKey: key,
        summary: compaction.summary,
        shadowedItemCount: compaction.shadowedItemCount,
        shadowedTokenCount: compaction.shadowedTokenCount,
      }
    }
    case 'model-retry': {
      const retry = (data as { current: { retryState: string } }).current as {
        delayMs: number
        retry: number
        mode: 'normal' | 'always'
        maxRetries?: number
        retryState: 'scheduled' | 'started' | 'cancelled'
        failure?: { message?: string } | null
      }
      return {
        kind: 'retry',
        nodeKey: key,
        delayMs: retry.delayMs,
        retry: retry.retry,
        maxRetries: retry.mode === 'normal' ? (retry.maxRetries ?? null) : null,
        mode: retry.mode,
        retryState: retry.retryState,
        failure: retry.failure === undefined || retry.failure === null
          ? null
          : { message: retry.failure.message ?? '' },
      }
    }
    case 'turn-error': {
      const error = data as TurnErrorNode
      return { kind: 'turn-error', nodeKey: key, message: error.message, code: error.code }
    }
    case 'turn-tail': {
      const tail = data as TurnTailChatData
      const location = node.location
      const turn = location.kind === 'turn' || location.kind === 'step' ? location.turn : undefined
      const closing = tail.closing
      const runMs = turn === undefined || turn.start === undefined || turn.end === undefined
        ? null
        : Math.max(0, turn.end.time - turn.start.time)
      const produced = producedForClosing(turn?.data.get('deliverables'), closing?.finalNode.seq ?? tail.seq)
      return {
        kind: 'turn-tail',
        nodeKey: key,
        turn: tail.turn,
        closingSeq: closing?.finalNode.seq ?? null,
        // Interruption-frozen partials carry no messageId, so they address no
        // durable message and contribute no per-message actions.
        closingMessageId: closing?.finalNode.messageId ?? null,
        closingTime: closing?.time ?? null,
        closingText: closing === null ? '' : assistantText(closing.blocks),
        runMs,
        ttftMs: tail.ttftMs ?? null,
        tokensPerSecond: tail.tokensPerSecond ?? null,
        branchUnavailable: tail.branchUnavailable,
        produced,
      }
    }
    default:
      return { kind: 'unknown', nodeKey: key, nodeKind: node.kind, data }
  }
}

/**
 * Build the condensed flow over the chat snapshot: consecutive `tool-call`
 * nodes fold into one group per run, and directly-consecutive runs merge
 * into a single group. A completed turn (its wall duration known) folds
 * everything except the closing assistant's reply — every intermediate
 * assistant row and tool run — into one `工作了 X 分 Y 秒` line, keeping the
 * running turn unfolded. Stale keys (node vanished from the live store) are
 * dropped.
 * @param order - snapshot chat order (stable node keys).
 * @param getNode - snapshot chat node reader.
 * @param cwd - session workspace root for relative path summaries.
 * @param home - host account home; a leftover POSIX home path displays as `~`.
 * @param cache - optional cross-build derivation cache: unchanged nodes and
 *  tool calls keep their previous item/row object identities, so memoized
 *  rows bail out while only the streaming tail changes.
 * @returns the condensed flow in order.
 */
export function buildFocusFlow(
  order: readonly string[],
  getNode: (key: string) => ChatConversationViewNode | undefined,
  cwd?: string,
  home?: string,
  cache?: FlowBuildCache,
): FocusFlowItem[] {
  // Pre-scan the order once: per-node turn membership, and for each turn the
  // wall boundaries (start/end), the closing assistant — the last assistant
  // step that carries a text reply, the one a completed turn keeps visible —
  // and whether the turn carries a mid-way interjection (a steering message
  // closes the current fold segment: each stretch between two interjections
  // folds with its own duration).
  const nodeTurn = new Map<string, number>()
  const turnPlans = new Map<number, {
    durationMs: number | null
    closingKey: string | null
    startTime: number | null
    endTime: number | null
    /** The user stopped the turn mid-run (an interrupted step or call). */
    stopped: boolean
  }>()
  for (const key of order) {
    const node = getNode(key)
    if (node === undefined || node.visibility === 'hidden') continue
    const location = node.location
    const turn = location.kind === 'turn' || location.kind === 'step' ? location.turn : undefined
    if (turn === undefined) continue
    nodeTurn.set(key, turn.turn)
    const plan = turnPlans.get(turn.turn)
    if (plan === undefined) {
      turnPlans.set(turn.turn, {
        durationMs: turn.start !== undefined && turn.end !== undefined
          ? Math.max(0, turn.end.time - turn.start.time)
          : null,
        closingKey: node.kind === 'assistant-step' && assistantHasText(node.data) ? key : null,
        startTime: turn.start?.time ?? null,
        endTime: turn.end?.time ?? null,
        stopped: stepInterrupted(node),
      })
    } else {
      if (node.kind === 'assistant-step' && assistantHasText(node.data)) plan.closingKey = key
      if (stepInterrupted(node)) plan.stopped = true
    }
  }

  const flow: FocusFlowItem[] = []
  let pending: { keys: string[]; blocks: ToolCallBlock[] } | null = null
  /** Turn-fold buffer: assistant rows and tool runs of the current completed
   *  turn segment (a mid-way interjection closes the segment). */
  let pendingFoldTurn: number | null = null
  let pendingFold: FocusFlowItem[] = []
  /** The buffered segment's wall-clock start: the turn start, or the previous
   *  interjection's time — the segment's worked duration reads end − start. */
  let pendingFoldStart: number | null = null
  /** Running-turn context batch: consecutive context injections merge into
   *  one collapsed line while the turn is open (a completed turn folds them
   *  individually into the turn fold instead). */
  let pendingContextTurn: number | null | undefined = undefined
  let pendingContext: FocusContextItem[] = []

  const keyOf = (item: FocusFlowItem): string =>
    item.kind === 'tools' ? item.group.nodeKeys[0] ?? 'tools' : item.nodeKey

  /** Emit the buffered rows as one `工作了 X 分 Y 秒` line. The duration
   *  reads `end − segmentStart` — a mid-way interjection passes its own time
   *  as the end, so each stretch between two interjections carries its own
   *  worked duration; a null end falls back to the turn's total wall time. A
   *  duration-less window cut renders the rows unfolded rather than a
   *  meaningless line. */
  const flushFold = (end: number | null): void => {
    const turnId = pendingFoldTurn
    pendingFoldTurn = null
    const start = pendingFoldStart
    pendingFoldStart = null
    const folded = pendingFold
    pendingFold = []
    if (turnId === null || folded.length === 0) return
    const plan = turnPlans.get(turnId)
    const endTime = end ?? plan?.endTime ?? null
    const durationMs = start !== null && endTime !== null
      ? Math.max(0, endTime - start)
      : plan?.durationMs ?? null
    if (durationMs === null) {
      for (const item of folded) flow.push(item)
      return
    }
    flow.push({
      kind: 'turn-fold',
      nodeKey: keyOf(folded[0]),
      turn: turnId,
      durationMs,
      stopped: plan?.stopped ?? false,
      items: folded,
    })
  }

  /** Emit the buffered running-turn context batch as one collapsed line. */
  const flushContext = (): void => {
    if (pendingContext.length === 0) return
    const first = pendingContext[0]
    flow.push({
      kind: 'context-fold',
      nodeKey: first.nodeKey,
      turn: pendingContextTurn ?? null,
      items: pendingContext,
    })
    pendingContext = []
    pendingContextTurn = undefined
  }

  /** Push one flow item, folding completed turns: a closed turn buffers every
   *  assistant row, context injection, and tool run until its closing reply
   *  arrives. User and steering messages stay visible — they are the
   *  conversation's anchors. */
  const pushItem = (item: FocusFlowItem): void => {
    // A settled assistant that paints nothing — only tool-call heads, the
    // chat shell rule — is a dead gap: drop it so no empty row sits between
    // the runs it separates (they still merge).
    if (item.kind === 'assistant' && !item.running && !item.interrupted
      && !item.blocks.some(block => block.kind !== 'tool-call')) return
    // A settled assistant's reasoning that directly follows a folded run
    // folds into that group: the tools ran first, then the next step's
    // Think disclosure, so the group carries both in flow order (the chat
    // order: think → reply → tool rows → next think). A leading think —
    // no preceding run — stays on the assistant and renders above its
    // reply; the streaming tail stays on the running assistant.
    if (item.kind === 'assistant' && !item.running && !item.interrupted) {
      const reasoning = item.blocks.filter(block => block.kind === 'reasoning')
      if (reasoning.length > 0) {
        const previous = pendingFold.length > 0
          ? pendingFold[pendingFold.length - 1]
          : flow.at(-1)
        if (previous !== undefined && previous.kind === 'tools') {
          const group = previous.group
          const folded = {
            ...previous,
            group: {
              ...group,
              items: [...group.items, ...reasoning.map(block => ({
                text: (block as { text: string }).text,
                running: false,
              }))],
              // The folded think leads the group's summary line (the
              // step-summary line keeps its thinking metric at the front);
              // a group already carrying a think sums the durations.
              thoughtMs: group.thoughtMs === null ? item.thoughtMs
                : item.thoughtMs === null ? group.thoughtMs
                  : group.thoughtMs + item.thoughtMs,
            },
          }
          if (pendingFold.length > 0) {
            pendingFold[pendingFold.length - 1] = folded
          } else {
            flow[flow.length - 1] = folded
          }
          const blocks = item.blocks.filter(block => block.kind !== 'reasoning')
          // A step left with nothing but tool-call heads paints nothing
          // (the chat shell rule) — the run that follows folds on its own.
          if (!blocks.some(block => block.kind !== 'tool-call')) return
          item = { ...item, blocks }
        }
      }
    }
    const key = keyOf(item)
    const turnId = nodeTurn.get(key)
    if (item.kind === 'message' && item.role === 'context') {
      // A completed turn folds the injection individually (below); an open or
      // plan-less turn batches consecutive injections into one collapsed line.
      const plan = turnId === undefined ? undefined : turnPlans.get(turnId)
      if (plan === undefined || plan.durationMs === null) {
        if (pendingContext.length > 0 && pendingContextTurn !== turnId) flushContext()
        pendingContextTurn = turnId
        // TS narrows the kind but not the object's role property (property
        // narrowing applies to accesses, not to the object argument); the
        // guard above proves the role.
        pendingContext.push(item as FocusContextItem)
        return
      }
    }
    flushContext()
    // A mid-way interjection closes the current fold segment — the worked
    // duration reads the stretch between the two interjections (segment end
    // = this steering's time) — and starts the next one; the user's own
    // voice itself stays visible.
    if (item.kind === 'message' && item.role === 'steering') {
      const plan = turnId === undefined ? undefined : turnPlans.get(turnId)
      if (plan !== undefined && plan.durationMs !== null) {
        flushFold(item.time)
        pendingFoldStart = item.time
      } else {
        flushFold(null)
      }
      flow.push(item)
      return
    }
    if (turnId === undefined
      || (item.kind === 'message' && item.role !== 'context')
      || item.kind === 'turn-tail') {
      flushFold(null)
      flow.push(item)
      return
    }
    const plan = turnPlans.get(turnId)
    if (plan === undefined || plan.durationMs === null) {
      flushFold(null)
      flow.push(item)
      return
    }
    // Completed turn: keep only the closing assistant's own reply visible.
    // Its own reasoning is part of the folded work — it moves into the fold
    // (the last folded row) instead of painting a second Thought row beside
    // the reply.
    const isClosing = item.kind === 'assistant' && key === plan.closingKey
    if (isClosing) {
      let closing: FocusFlowItem = item
      if (item.kind === 'assistant' && item.blocks.some(block => block.kind === 'reasoning')) {
        const blocks: AssistantBlock[] = []
        for (const block of item.blocks) {
          if (block.kind === 'reasoning') {
            pendingFold.push({ ...item, blocks: [block] })
          } else {
            blocks.push(block)
          }
        }
        pendingFoldTurn = turnId
        closing = { ...item, blocks }
      }
      // A closing reply that lands with nothing buffered still ends the
      // current stretch — but only when a stretch is actually open. When a
      // mid-turn steering opened a fresh segment whose rows arrive after this
      // reply (the chat can emit the closing text, then keep running tools in
      // the same step), flushing now would clear the segment start and the
      // later rows would fold from the turn start, misreading the stretch.
      if (pendingFold.length > 0 || pendingFoldStart === null) {
        flushFold(null)
      }
      flow.push(closing)
      return
    }
    if (item.kind === 'assistant'
      || item.kind === 'tools'
      || (item.kind === 'message' && item.role === 'context')) {
      if (pendingFoldTurn !== null && pendingFoldTurn !== turnId) flushFold(null)
      pendingFoldTurn = turnId
      if (pendingFold.length === 0 && pendingFoldStart === null) {
        // First buffered row of the segment: the stretch began at the turn
        // start (a later segment's start was set by its interjection).
        pendingFoldStart = plan.startTime
      }
      pendingFold.push(item)
      return
    }
    flushFold(null)
    flow.push(item)
  }

  const flush = (): void => {
    if (pending === null) return
    // Local aliases: the group cache callbacks below would otherwise defeat
    // TypeScript's narrowing of `pending`.
    const runKeys = pending.keys
    const runBlocks = pending.blocks
    // v8 ignore next -- unreachable: pending is created only by a visible tool-call node
    if (runBlocks.length > 0) {
      // The run's tools fold into one group. The assistant rows that precede
      // the run keep their chronological positions — the Think row above its
      // reply — so the group follows them (the chat order: think → reply →
      // tool rows); the group line carries the tool metrics only.
      const groupTurn = nodeTurn.get(runKeys[0]) ?? null
      const previousAfterAssistant = pendingFold.length > 0
        ? pendingFold[pendingFold.length - 1]
        : flow.at(-1)
      // Absorb a context batch preceding the run into the group: its count
      // leads a segment of the summary line, its rows expand inside the
      // group (session order: context → thinking → calls). An assistant row
      // (its own Think disclosure) may sit between the batch and the run —
      // look past it, the batch still belongs to the run. A context batch
      // with no adjacent run keeps its own folded line.
      let contextProbe = previousAfterAssistant
      if (contextProbe !== undefined && contextProbe.kind === 'assistant') {
        contextProbe = pendingFold.length > 1
          ? pendingFold[pendingFold.length - 2]
          : flow.at(-2)
      }
      let absorbedContext: readonly FocusContextItem[] = []
      if (contextProbe !== undefined
        && contextProbe.kind === 'context-fold'
        && contextProbe.turn === groupTurn) {
        absorbedContext = contextProbe.items
        if (pendingFold.length > 0) {
          pendingFold.splice(pendingFold.length - (contextProbe === previousAfterAssistant ? 1 : 2), 1)
        } else {
          flow.splice(flow.length - (contextProbe === previousAfterAssistant ? 1 : 2), 1)
        }
      }
      const group = toolGroup(runBlocks, cwd, null, [], home, cache?.rows === undefined ? undefined : { rows: cache.rows })
      // A notice-form injection (a tool-jobs settlement) is background-job
      // activity, not context the user loaded: it counts into the jobs
      // family ("后台任务 N 个" / "N background jobs") and leaves the loaded
      // context count to the non-notice injections. Its row still expands
      // inside the group with the notice body.
      const noticeJobs = absorbedContext.filter(item => item.context?.form === 'notice').length
      const folded: FocusToolGroup = {
        ...group,
        nodeKeys: runKeys,
        items: [...absorbedContext, ...group.items],
        contextCount: absorbedContext.length - noticeJobs,
        context: absorbedContext,
        metrics: { ...group.metrics, jobs: group.metrics.jobs + noticeJobs },
      }
      // Merge directly-consecutive runs — in the flow or in the turn-fold
      // buffer — into one summary line: metrics and thinking time aggregate,
      // the rows keep flow order. Anything between two runs — an assistant
      // row (its Think disclosure or its reply), a command, a message —
      // keeps them separate.
      const previousItem = pendingFold.length > 0
        ? pendingFold[pendingFold.length - 1]
        : flow.at(-1)
      if (previousItem !== undefined && previousItem.kind === 'tools') {
        const prev = previousItem.group
        const merged: FocusToolGroup = {
          nodeKeys: [...prev.nodeKeys, ...folded.nodeKeys],
          items: [...prev.items, ...folded.items],
          running: prev.running || folded.running,
          metrics: {
            commands: prev.metrics.commands + folded.metrics.commands,
            edits: prev.metrics.edits + folded.metrics.edits,
            searches: prev.metrics.searches + folded.metrics.searches,
            files: prev.metrics.files + folded.metrics.files,
            dirs: prev.metrics.dirs + folded.metrics.dirs,
            subagents: prev.metrics.subagents + folded.metrics.subagents,
            todos: prev.metrics.todos + folded.metrics.todos,
            goals: prev.metrics.goals + folded.metrics.goals,
            workflows: prev.metrics.workflows + folded.metrics.workflows,
            skills: prev.metrics.skills + folded.metrics.skills,
            questions: prev.metrics.questions + folded.metrics.questions,
            plans: prev.metrics.plans + folded.metrics.plans,
            jobs: prev.metrics.jobs + folded.metrics.jobs,
            commandsFailed: prev.metrics.commandsFailed + folded.metrics.commandsFailed,
            searchesFailed: prev.metrics.searchesFailed + folded.metrics.searchesFailed,
          },
          contextCount: prev.contextCount + folded.contextCount,
          context: [...prev.context, ...folded.context],
          thoughtMs: prev.thoughtMs === null ? folded.thoughtMs
            : folded.thoughtMs === null ? prev.thoughtMs
              : prev.thoughtMs + folded.thoughtMs,
        }
        if (pendingFold.length > 0) {
          pendingFold[pendingFold.length - 1] = { kind: 'tools', group: merged }
        } else {
          flow[flow.length - 1] = { kind: 'tools', group: merged }
        }
      } else {
        // A standalone group (no consecutive-run merge, no absorbed context
        // batch) is shape-stable while its blocks keep their references:
        // reuse the previous emitted item so the memoized group row never
        // re-renders during unrelated streaming.
        const groupKey = runKeys.join('\u0000')
        const cachedGroup = cache?.groups.get(groupKey)
        if (cachedGroup !== undefined
          && absorbedContext.length === 0
          && cachedGroup.blocks.length === runBlocks.length
          && cachedGroup.blocks.every((block, index) => block === runBlocks[index])) {
          pushItem(cachedGroup.item)
        } else {
          const item = { kind: 'tools' as const, group: folded }
          if (cache !== undefined && absorbedContext.length === 0) {
            cache.groups.set(groupKey, { blocks: runBlocks, item })
          }
          pushItem(item)
        }
      }
    }
    pending = null
  }
  for (const key of order) {
    const node = getNode(key)
    if (node === undefined || node.visibility === 'hidden') continue
    if (node.kind === 'tool-call') {
      const data = node.data as ToolChatData
      if (pending === null) pending = { keys: [], blocks: [] }
      pending.keys.push(key)
      pending.blocks.push(data.root)
      continue
    }
    flush()
    const item = flowItemCached(cache, key, node, node.data as FocusNodeData)
    if (item !== null) pushItem(item)
  }
  flush()
  flushFold(null)
  flushContext()
  return flow
}

/** Whether one assistant-step node's blocks carry a visible text reply. */
function assistantHasText(data: unknown): boolean {
  const blocks = (data as AssistantChatData).blocks
  return blocks.some(block => block.kind === 'text' && block.text.trim() !== '')
}

/** The durable error codes a user stop lands on a running tool call.
 *  `interrupted` is the tool's own cancellation code; `TOOL_OUTCOME_UNKNOWN`
 *  and `TOOL_NOT_STARTED` are the repair pass's synthetic closers for a call
 *  cut mid-execution (the user stopped the turn while the tool was running —
 *  the outcome is unknown, but the stop is the user's, not a tool failure). */
const STOPPED_TOOL_CODES: ReadonlySet<string> = new Set([
  'interrupted',
  'TOOL_OUTCOME_UNKNOWN',
  'TOOL_NOT_STARTED',
])

/** Whether one chat node marks a user-stopped step: an interrupted assistant
 *  step, or a settled tool call carrying one of the stop error codes. */
function stepInterrupted(node: ChatConversationViewNode): boolean {
  if (node.kind === 'assistant-step') {
    return (node.data as AssistantChatData).status === 'interrupted'
  }
  if (node.kind === 'tool-call') {
    const root = (node.data as ToolChatData).root
    return 'kind' in root && root.error !== undefined && STOPPED_TOOL_CODES.has(root.error.code)
  }
  return false
}