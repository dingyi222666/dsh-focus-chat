// @vitest-environment jsdom
/** Focus-view settings: the preference policy, the General-section rows, the
 *  Codex-style changes-bar diff renderer, and the markdown highlight mode. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { FocusSettingsPolicy } from '../src/client/focus-settings.ts'
import { DiffStyleRow } from '../src/client/settings/DiffStyleRow.tsx'
import { MdStyleRow } from '../src/client/settings/MdStyleRow.tsx'
import { ChangesBarDiff } from '../src/client/view/rows/ChangesBarDiff.tsx'
import { DEFAULT_FOCUS_SETTINGS, resolveFocusSettings } from '../src/settings.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = makeTranslate(zh)

describe('resolveFocusSettings', () => {
  it('applies defaults when nothing is stored', () => {
    expect(resolveFocusSettings(undefined)).toEqual(DEFAULT_FOCUS_SETTINGS)
    expect(resolveFocusSettings({})).toEqual(DEFAULT_FOCUS_SETTINGS)
  })

  it('accepts valid choices and drops malformed ones', () => {
    expect(resolveFocusSettings({ diffStyle: 'codex-bar', mdStyle: 'highlight' })).toEqual({
      diffStyle: 'codex-bar',
      mdStyle: 'highlight',
    })
    expect(resolveFocusSettings({ diffStyle: 'nope', mdStyle: 42 })).toEqual(DEFAULT_FOCUS_SETTINGS)
  })
})

describe('FocusSettingsPolicy', () => {
  it('adopts the host section and persists choices', async () => {
    const host = createSnapshotStore<{
      status: 'ready'
      value: { diffStyle: 'codex-bar'; mdStyle: 'highlight' } | undefined
      base: unknown
      user: unknown
      revision: number | undefined
      writable: boolean
      mode: 'host' | 'memory'
    }>({
      status: 'ready',
      value: { diffStyle: 'codex-bar', mdStyle: 'highlight' },
      base: undefined,
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host',
    })
    // A minimal SettingsScope-shaped handle over the store.
    const scope = {
      getSnapshot: () => host.getSnapshot(),
      subscribe: (listener: () => void) => host.subscribe(listener),
      set: vi.fn(async () => {}),
      unset: vi.fn(async () => {}),
      mutate: vi.fn(async () => {}),
    }
    const policy = new FocusSettingsPolicy(scope as never)
    expect(policy.diffStyle.getSnapshot()).toBe('codex-bar')
    expect(policy.mdStyle.getSnapshot()).toBe('highlight')

    policy.setDiffStyle('default')
    expect(policy.diffStyle.getSnapshot()).toBe('default')
    expect(scope.set).toHaveBeenCalledWith('diffStyle', 'default')
    policy.setMdStyle('default')
    expect(scope.set).toHaveBeenCalledWith('mdStyle', 'default')
  })

  it('defaults to the official surfaces before the host section arrives', () => {
    const scope = {
      getSnapshot: () => ({ status: 'loading' as const, value: undefined }),
      subscribe: () => () => {},
      set: async () => {},
      unset: async () => {},
      mutate: async () => {},
    }
    const policy = new FocusSettingsPolicy(scope as never)
    expect(policy.diffStyle.getSnapshot()).toBe('default')
    expect(policy.mdStyle.getSnapshot()).toBe('default')
  })
})

describe('settings rows', () => {
  it('renders the diff-style row with the current choice and switches it', () => {
    const diffStyle = createSnapshotStore<'default' | 'codex-bar'>('default')
    const setDiffStyle = vi.fn()
    render(
      <DiffStyleRow
        useSessions={(() => undefined) as never}
        useSessionPendingInteraction={(() => undefined) as never}
        useWorkspaces={(() => undefined) as never}
        useDiffStyle={selector => selector(diffStyle.getSnapshot())}
        setDiffStyle={setDiffStyle}
        t={t}
      />,
    )
    expect(screen.getByText('Diff 风格')).toBeTruthy()
    expect(screen.getByText('dsh 默认')).toBeTruthy()
    fireEvent.click(screen.getByText('dsh 默认'))
    fireEvent.click(screen.getByText('Codex 变更条'))
    expect(setDiffStyle).toHaveBeenCalledWith('codex-bar')
  })

  it('renders the markdown-style row with the current choice and switches it', () => {
    const mdStyle = createSnapshotStore<'default' | 'highlight'>('default')
    const setMdStyle = vi.fn()
    render(
      <MdStyleRow
        useSessions={(() => undefined) as never}
        useSessionPendingInteraction={(() => undefined) as never}
        useWorkspaces={(() => undefined) as never}
        useMdStyle={selector => selector(mdStyle.getSnapshot())}
        setMdStyle={setMdStyle}
        t={t}
      />,
    )
    expect(screen.getByText('Markdown 行内代码')).toBeTruthy()
    expect(screen.getByText('dsh 默认')).toBeTruthy()
    fireEvent.click(screen.getByText('dsh 默认'))
    fireEvent.click(screen.getByText('高亮模式'))
    expect(setMdStyle).toHaveBeenCalledWith('highlight')
  })
})

describe('ChangesBarDiff', () => {
  const labels = {
    copy: '复制',
    copied: '已复制',
    collapseAria: '收起差异',
    expandAria: (count: number) => `展开其余 ${count} 行差异`,
    collapse: '收起',
    expand: (hidden: number) => `展开 ${hidden} 行`,
    files: (count: number) => `${count} 个文件`,
  }

  it('renders the path header, aligned rows, change bars, and footer', () => {
    render(<ChangesBarDiff diffs={[
      { path: 'src/a.ts', oldText: 'a\nb', newText: 'a\nb\nc' },
    ]} labels={labels} maxLines={8} />)
    expect(screen.getByText('src/a.ts')).toBeTruthy()
    // The two context rows 'a' and 'b' and the added 'c'.
    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.getByText('b')).toBeTruthy()
    expect(screen.getByText('c')).toBeTruthy()
    expect(screen.getByText((_content, element) => element?.textContent === '└ +1 -0 · 1 个文件')).toBeTruthy()
    expect(screen.queryAllByText('+').length).toBe(1)
    expect(screen.queryAllByText('-').length).toBe(0)
  })

  it('marks deletions and pairs the delta words', () => {
    render(<ChangesBarDiff diffs={[
      { path: 'b.ts', oldText: 'keep\nkeep old line', newText: 'keep\nkeep new line' },
    ]} labels={labels} maxLines={8} />)
    // The changed middle of the paired line carries the delta mark; the
    // shared prefix and suffix stay plain. The line text is split into
    // head/delta/tail spans, so match each row by its whole textContent.
    const lineOf = (text: string): Element | null => {
      const rows = document.querySelectorAll('[data-changes-bar-line]')
      for (const row of rows) {
        // The +/- sign rides the row; the line text is the rest.
        if (row.textContent === `-${text}` || row.textContent === `+${text}`) return row
      }
      return null
    }
    expect(lineOf('keep old line')?.querySelector('[class*="delta"]')?.textContent).toBe('old')
    expect(lineOf('keep new line')?.querySelector('[class*="delta"]')?.textContent).toBe('new')
    // Footer counts one deletion and one insertion.
    expect(screen.getByText((_content, element) => element?.textContent === '└ +1 -1 · 1 个文件')).toBeTruthy()
  })

  it('folds the middle beyond the cap and expands it', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`)
    render(<ChangesBarDiff diffs={[
      { path: 'c.ts', oldText: null, newText: lines.join('\n') },
    ]} labels={labels} maxLines={8} />)
    // 20 added lines + the path header = 21 body rows; the cap keeps 8 and
    // the fold button names the hidden 13.
    expect(screen.getByText('展开 13 行')).toBeTruthy()
    fireEvent.click(screen.getByText('展开 13 行'))
    expect(screen.getByText('line 19')).toBeTruthy()
  })
})
