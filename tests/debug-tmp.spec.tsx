import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ToolCallRow } from '../src/client/view/rows/ToolCallRow.tsx'
import { zh } from '../src/client/locales.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'

describe('dbg row', () => {
  it('dumps the row', () => {
    const t = makeTranslate(zh)
    const row = {
      callId: 'c1', name: 'bash', variant: 'bash' as const, title: 'Bash', summary: 'pnpm build',
      filePath: undefined, state: 'ok' as const, output: 'built ok', errorSummary: null, errorCode: null,
      time: null, body: null, card: null, subcalls: [], changeStat: null,
    }
    const { container } = render(<ToolCallRow row={row as never} t={t} openFile={() => {}} />)
    const html = container.innerHTML
    // extract the leading + title area
    const leadIdx = html.indexOf('data-disclosure-row')
    console.log('ROW HTML:', html.slice(0, Math.min(html.length, 900)))
  })
})
