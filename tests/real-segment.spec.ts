/** Real-session segment replay: turn 79 steps 88-92 (npm-migration turn),
 *  replayed through buildFocusFlow to pin the chronological row order the
 *  official chat shows (reply → its own tool rows). */
import { describe, expect, it } from 'vitest'
import type { ChatConversationViewNode, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { buildFocusFlow } from '../src/client/model/flow.ts'
import type { FocusFlowItem } from '../src/client/model/types.ts'

function node(
  key: string,
  kind: string,
  data: unknown,
  step: number,
): ChatConversationViewNode {
  return {
    key, kind, id: key, target: 'chat', anchorSeq: step * 10,
    location: {
      kind: 'step',
      turn: { turn: 79, start: { seq: step * 10, time: step * 1000 }, end: undefined },
      step: { step },
    },
    visibility: 'visible',
    data,
  } as never
}

function bashCall(callId: string, description: string): ToolResultNode {
  return {
    kind: 'tool-result', seq: 1, time: 1000, callId,
    call: { name: 'bash', argsRaw: JSON.stringify({ command: 'x', description }) },
    callTime: 1000, content: [], isError: false, callView: null, resultView: null, subCalls: [],
  }
}

function assistant(
  key: string,
  step: number,
  blocks: unknown[],
  thoughtMs: number | null,
): ChatConversationViewNode {
  return node(key, 'assistant-step', {
    status: 'settled', turn: 79, step, time: step * 1000,
    blocks,
    finalNode: {
      seq: step * 100,
      timing: {
        stepStartTime: step * 1000,
        firstTokenTime: thoughtMs === null ? null : step * 1000 + thoughtMs,
      },
    },
  }, step)
}

const nodes: ChatConversationViewNode[] = [
  assistant('a88', 88, [
    { kind: 'reasoning', text: '56 tests PASS on the npm rc.1 line!' },
    { kind: 'text', text: '56 个测试在 npm rc.1 线上全绿！继续：typecheck → build → pack：' },
    { kind: 'tool-call', callId: 'b1', name: 'bash', arguments: '{}' },
  ], 3000),
  node('t88', 'tool-call', { root: bashCall('b1', 'Typecheck and build on the npm line') }, 88),
  assistant('a89', 89, [
    { kind: 'tool-call', callId: 'b2', name: 'bash', arguments: '{}' },
  ], null),
  node('t89', 'tool-call', { root: bashCall('b2', 'Pack the plugin tarball') }, 89),
  assistant('a90', 90, [
    { kind: 'reasoning', text: 'Pack works (40 files, 59KB tarball).' },
    { kind: 'text', text: 'tarball 生成（59KB）。做消费验证——先看 rc.1 CLI 的用法：' },
    { kind: 'tool-call', callId: 'b3', name: 'bash', arguments: '{}' },
  ], 3000),
  node('t90', 'tool-call', { root: bashCall('b3', 'Show the rc.1 dsh CLI help') }, 90),
  assistant('a91', 91, [
    { kind: 'reasoning', text: 'The npx couldn\'t fetch @deepseek-ai/dsh@0.0.1-rc.1.' },
    { kind: 'tool-call', callId: 'b4', name: 'bash', arguments: '{}' },
  ], 2500),
  node('t91', 'tool-call', { root: bashCall('b4', 'Set up the consumer and show the CLI help') }, 91),
]

const byKey = new Map(nodes.map(n => [n.key, n]))

function describeRows(flow: readonly FocusFlowItem[]): string[] {
  return flow.map(item => {
    switch (item.kind) {
      case 'assistant':
        return `text: ${item.blocks.filter(b => b.kind === 'text').map(b => (b as { text: string }).text).join('')}`
      case 'tools': {
        const g = item.group
        const think = g.items.filter(i => !('callId' in i)).map(i => `think:${(i as { text: string }).text.slice(0, 12)}`)
        const rows = g.items.filter(i => 'callId' in i).map(i => (i as { summary: string }).summary)
        return `group[thought=${g.thoughtMs === null ? 'null' : `${g.thoughtMs / 1000}s`}]: [${[...think, ...rows].join(' | ')}]`
      }
      default:
        return `${item.kind}`
    }
  })
}

it('renders reply → its own tool rows (chronological)', () => {
  const flow = buildFocusFlow(nodes.map(n => n.key), key => byKey.get(key), '/u')
  const rows = describeRows(flow)
  console.log('=== FOCUS FLOW (fixed) ===')
  for (const row of rows) console.log(row)
  // The two commands text88 announces must sit right below it.
  expect(rows[0]).toBe('text: 56 个测试在 npm rc.1 线上全绿！继续：typecheck → build → pack：')
  expect(rows[1]).toContain('Typecheck and build on the npm line')
  expect(rows[1]).toContain('Pack the plugin tarball')
  // think90 + bash#3 fold into the group below text90.
  expect(rows[2]).toBe('text: tarball 生成（59KB）。做消费验证——先看 rc.1 CLI 的用法：')
  expect(rows[3]).toContain('Show the rc.1 dsh CLI help')
  // think91's run stays a separate group (its think is the chat's barrier).
  expect(rows[4]).toContain('Set up the consumer and show the CLI help')
})
