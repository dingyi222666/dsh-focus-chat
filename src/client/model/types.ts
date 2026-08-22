/** Pure type face of the focus flow model (React-free). */
import type { DiffHunk, ReadBlockLine, SearchBlockProps, WebBlockProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { AssistantBlock, ContextMessageNode, SteeringMessageNode, UserMessageNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeDataMap } from '@deepseek-ai/dsh-client-ui-conversation/client'

export type FocusCard =
  | { kind: 'terminal'; command: string; cwd: string | undefined; output: string | undefined; exitCode: number | undefined; signal: string | undefined; running: boolean; description: string | undefined }
  | { kind: 'diff'; diffs: DiffHunk[] }
  | { kind: 'read'; label: string; lines: ReadBlockLine[]; totalLines: number; lang: string | undefined }
  | { kind: 'search'; props: SearchBlockProps; recovery: string | undefined; title: string | undefined }
  | { kind: 'web'; props: WebBlockProps }

/** Tool-row state semantics; colors self-supplied by the view. */
export type FocusToolState = 'running' | 'ok' | 'error' | 'stopped'

/** Tool-call row variants selected by the generic renderer (the chat table). */
export type FocusToolVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'code' | 'question' | 'todo' | 'skill' | 'others'

/** One Tool call's condensed row model, derived from the frozen block. */
export interface FocusToolRow {
  callId: string
  /** Wire Tool name ('' when the window dropped the call head). */
  name: string
  /** Row variant (the chat row's classification). */
  variant: FocusToolVariant
  /** Row title: the tool-owned or variant design literal (the chat row's). */
  title: string
  /** Args-derived one-line summary (falls back to the call id). */
  summary: string
  /** Filesystem path from args for single-file tools; undefined otherwise. */
  filePath: string | undefined
  state: FocusToolState
  /** Flattened result text; null while running or when the result has none. */
  output: string | null
  /** First result line on an error row; null otherwise. */
  errorSummary: string | null
  /** Settled call's structured error code; null while running or when the
   *  result carries no error (the ask-question row's verdict codes). */
  errorCode: string | null
  /** Call start wall-clock time; null once settled. The view's live-row
   *  debounce reads it (a young running call paints nothing). */
  time: number | null
  /** Expanded-body input text (pretty args); null = no input section. */
  body: string | null
  /** Card render material from the host-computed views; null = generic sections. */
  card: FocusCard | null
  /** Recursive child rows (the sub-call tree), in dispatch order. */
  subcalls: readonly FocusToolRow[]
}

/** One reasoning row absorbed into a tool group (the chat Think disclosure). */
export interface FocusGroupThink {
  /** Complete or streaming reasoning text. */
  text: string
  /** Whether the reasoning is still the streaming tail (sweep + tail preview). */
  running: boolean
}

/** One folded row inside a tool group: an absorbed context row, an absorbed
 *  Think row, or a call. */
export type FocusGroupItem = FocusContextItem | FocusGroupThink | FocusToolRow

/** Step-summary metric families the group line aggregates, in display order. */
export type FocusMetricKey =
  | 'commands' | 'edits' | 'searches' | 'files' | 'dirs'
  | 'subagents' | 'todos' | 'goals' | 'workflows'
  | 'skills' | 'questions' | 'plans' | 'jobs'

/** Tool name → metric family; unknown tools carry no metric. Writes fold
 *  into the edit family (the summary line reads one "edited" segment); the
 *  agentic families (delegation, todo, goal, workflow, skill, question,
 *  plan) replace the generic "called N tools" remainder for their own tools. */
export interface FocusGroupMetrics {
  commands: number
  edits: number
  searches: number
  files: number
  dirs: number
  /** Delegation calls (subagent / subagent_fork): "forked N subagents". */
  subagents: number
  /** Todo mutations (todo_write): "更新了待办 / updated todos". */
  todos: number
  /** Goal mutations (create/update/get_goal): "更新了目标 / updated goals". */
  goals: number
  /** Orchestration calls (workflow / ralph): "ran N workflows". */
  workflows: number
  /** Skill loads (skill): "loaded N skills". */
  skills: number
  /** User questions (ask_user_question): "asked N questions". */
  questions: number
  /** Plan-mode entries (plan): "planned N times". */
  plans: number
  /** Background-job activity (job_output / job_kill / job_list calls and the
   *  tool-jobs settlements a `notice` context injection carries): the summary
   *  line reads "N background jobs" — the settlement's own one-line account
   *  no longer rides the line verbatim. */
  jobs: number
  /** Failed calls in the failure-aware families (error-state rows): command
   *  execution and other tools. File operations never carry a failure tally —
   *  the edit family's count is the outcome (distinct files actually edited). */
  commandsFailed: number
  searchesFailed: number
}

/** One focus-mode group: the consecutive root calls folded into a summary line. */
export interface FocusToolGroup {
  /** Chat node keys of the folded roots, in flow order. */
  nodeKeys: readonly string[]
  /** Folded rows in flow order: the absorbed context rows, Think rows, and the calls. */
  items: readonly FocusGroupItem[]
  /** Whether any folded call is still running. */
  running: boolean
  /** Per-family call counts, with failure tallies for the failure-aware families. */
  metrics: FocusGroupMetrics
  /** Context injections directly preceding the run, absorbed into the group. */
  contextCount: number
  context: readonly FocusContextItem[]
  /**
   * Thinking time of the runs folded into this group, summed when every run
   * carries timing (the group merges directly-consecutive runs); null when
   * unavailable.
   */
  thoughtMs: number | null
}

/** One context-injection message row (the chat ContextInjectionRow chrome). */
export type FocusContextItem = Extract<FocusFlowItem, { kind: 'message' }> & { role: 'context' }

/** One condensed flow row; the view dispatches on `kind`. */
export type FocusFlowItem =
  | {
    kind: 'message'
    nodeKey: string
    role: 'user' | 'steering' | 'context'
    content: readonly ContentBlock[]
    time: number
    /** Context-injection chrome (the chat ContextInjectionRow); absent for user/steering. */
    context?: { source: ContextMessageNode['source']; provenance: ContextMessageNode['provenance']; form: ContextMessageNode['form'] }
  }
  | {
    /**
     * One running turn's context batch: consecutive context injections
     * folded into a single line while the turn is open (a completed turn
     * folds them individually into the turn fold instead).
     */
    kind: 'context-fold'
    nodeKey: string
    turn: number | null
    /** The merged context messages, in flow order. */
    items: readonly FocusContextItem[]
  }
  | {
    kind: 'assistant'
    nodeKey: string
    /** Remaining blocks; reasoning absorbed into a directly-following tool group is filtered out. */
    blocks: readonly AssistantBlock[]
    running: boolean
    interrupted: boolean
    thoughtMs: number | null
    /** Settled assistant seq; null while streaming. */
    finalSeq: number | null
  }
  | { kind: 'tools'; group: FocusToolGroup }
  | {
    kind: 'turn-fold'
    nodeKey: string
    turn: number
    /** Turn wall time (start → end); the "工作了 X 分 Y 秒" reading. */
    durationMs: number
    /** The user stopped the turn: the line reads "用户 X 后停止" instead. */
    stopped: boolean
    /** The turn's folded rows — intermediate assistant items and tool runs — in flow order. */
    items: readonly FocusFlowItem[]
  }
  | {
    kind: 'turn-tail'
    nodeKey: string
    turn: number
    /** Closing assistant seq — the fork anchor; null when the turn ended without one. */
    closingSeq: number | null
    /** Durable identity of the closing assistant message; null when the turn
     *  ended without one (interruption-frozen partial). */
    closingMessageId: string | null
    /** Closing assistant time (the actions clock). */
    closingTime: number | null
    /** Text of the closing assistant (the copy source). */
    closingText: string
    /** Turn wall time for the `· Ran for Ns` reading. */
    runMs: number | null
    /** Turn first-step TTFT in ms, when recorded. */
    ttftMs: number | null
    /** Turn decode throughput, when recorded. */
    tokensPerSecond: number | null
    /** Whether fork is unavailable (engine-computed; mirrors the chat tail). */
    branchUnavailable: boolean
    /** Files produced by the closing turn, in first-seen order. */
    produced: readonly string[]
  }
  | { kind: 'command'; nodeKey: string; name: string | null; args: string | null; outcomeText: string | null; outcomeError: boolean; running: boolean }
  | { kind: 'manual-compaction'; nodeKey: string; name: string | null; outcomeText: string | null; outcomeError: boolean; running: boolean; compaction: { summary: string | null; shadowedItemCount: number | null; shadowedTokenCount: number | null } | null }
  | { kind: 'compaction'; nodeKey: string; summary: string | null; shadowedItemCount: number | null; shadowedTokenCount: number | null }
  | {
    kind: 'retry'
    nodeKey: string
    delayMs: number
    retry: number
    /** 'always' retries never exhaust; the chat row shows ∞. */
    maxRetries: number | null
    mode: 'normal' | 'always'
    retryState: 'scheduled' | 'started' | 'cancelled'
    failure: { message: string } | null
  }
  | { kind: 'turn-error'; nodeKey: string; message: string; code: string | undefined }
  | { kind: 'unknown'; nodeKey: string; nodeKind: string; data: unknown }

/** The chat node data union the focus view narrows, keyed by the merge-extensible map. */
export type FocusNodeData = ChatNodeDataMap[Extract<keyof ChatNodeDataMap, string>]

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths accumulated in this turn (the ui-deliverables contract). */
    deliverables: FocusDeliverablesData
  }
}

/** One produced-path fact (the ui-deliverables turn data contract). */
export interface FocusDeliverablesData {
  readonly produced: readonly { readonly seq: number; readonly path: string }[]
}

