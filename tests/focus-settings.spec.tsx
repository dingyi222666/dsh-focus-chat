// @vitest-environment jsdom
/** Focus-view settings: the preference policy, the Focus chat settings
 *  section, the Codex-style changes-bar diff renderer, and the markdown
 *  highlight mode. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { FocusSettingsPolicy } from '../src/client/focus-settings.ts'
import { FocusSettingsSection } from '../src/client/settings/FocusSettingsSection.tsx'
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

describe('FocusSettingsSection', () => {
  const sectionProps = (overrides: {
    diffStyle?: 'default' | 'codex-bar'
    mdStyle?: 'default' | 'highlight'
  } = {}) => ({
    close: vi.fn(),
    useSessions: (() => undefined) as never,
    useSessionPendingInteraction: (() => undefined) as never,
    useWorkspaces: (() => undefined) as never,
    useDiffStyle: ((selector: (s: 'default' | 'codex-bar') => unknown) => selector(overrides.diffStyle ?? 'default')) as never,
    useMdStyle: ((selector: (s: 'default' | 'highlight') => unknown) => selector(overrides.mdStyle ?? 'default')) as never,
    setDiffStyle: vi.fn(),
    setMdStyle: vi.fn(),
    t,
  })

  it('renders the section title and the two preference rows', () => {
    render(<FocusSettingsSection {...sectionProps()} />)
    expect(screen.getByText('聚焦对话')).toBeTruthy()
    expect(screen.getByText('Diff 风格')).toBeTruthy()
    expect(screen.getByText('Markdown 行内代码')).toBeTruthy()
  })

  it('switches the diff style through the section', () => {
    const props = sectionProps()
    render(<FocusSettingsSection {...props} />)
    // Scope to the diff row: walk up from the title to the row container
    // (the first ancestor that directly owns a selector button). Both rows
    // read "默认", so the row must be located by its title first.
    const rowOf = (title: string): HTMLElement => {
      let el: HTMLElement | null = screen.getByText(title)
      while (el !== null && el.querySelector('button[aria-haspopup]') === null) {
        el = el.parentElement
      }
      if (el === null) throw new Error(`row of "${title}" not found`)
      return el
    }
    // Open the diff row's menu, then pick the option (the menu portals to the
    // body, so the option is found globally).
    fireEvent.click(within(rowOf('Diff 风格')).getByRole('button', { name: /默认/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Codex 变更条/ }))
    expect(props.setDiffStyle).toHaveBeenCalledWith('codex-bar')
  })

  it('switches the markdown style through the section', () => {
    const props = sectionProps()
    render(<FocusSettingsSection {...props} />)
    const rowOf = (title: string): HTMLElement => {
      let el: HTMLElement | null = screen.getByText(title)
      while (el !== null && el.querySelector('button[aria-haspopup]') === null) {
        el = el.parentElement
      }
      if (el === null) throw new Error(`row of "${title}" not found`)
      return el
    }
    fireEvent.click(within(rowOf('Markdown 行内代码')).getByRole('button', { name: /默认/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /高亮模式/ }))
    expect(props.setMdStyle).toHaveBeenCalledWith('highlight')
  })

  it('shows the selected values from the live stores', () => {
    render(<FocusSettingsSection {...sectionProps({ diffStyle: 'codex-bar', mdStyle: 'highlight' })} />)
    // Both selectors show their current choice; the other options still exist.
    expect(screen.getAllByText('Codex 变更条').length).toBeGreaterThan(0)
    expect(screen.getAllByText('高亮模式').length).toBeGreaterThan(0)
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
  const expandLabels = {
    unchangedLines: (count: number) => `${count} 行未变更`,
    expandUp: '向上展开',
    expandDown: '向下展开',
    expandBoth: '展开隐藏行',
  }

  it('renders the path header with its own stat, split panels, and change bars', () => {
    render(<ChangesBarDiff diffs={[
      { path: 'src/a.ts', oldText: 'a\nb', newText: 'a\nb\nc' },
    ]} labels={labels} expandLabels={expandLabels} maxLines={8} />)
    // The path header carries this file's +3 -2 reading (whole-side line
    // counts, the same totals the reference draws).
    const header = screen.getByText('src/a.ts').closest('[data-changes-bar-path]')
    expect(header?.querySelector('[data-changes-bar-stat]')?.textContent).toBe('+3-2')
    // Context lines appear in BOTH panels; the added line only on the right.
    expect(screen.getAllByText('a').length).toBe(2)
    expect(screen.getAllByText('b').length).toBe(2)
    expect(screen.getByText('c')).toBeTruthy()
    // The left panel's change bar stripes deletions, the right panel's bar
    // fills additions solid.
    expect(document.querySelector('[class*="barDelete"]')).toBeTruthy()
    expect(document.querySelector('[class*="barAdd"]')).toBeTruthy()
    // No card footer anymore.
    expect(document.body.textContent).not.toContain('└')
  })

  it('marks deletions and pairs the delta words', () => {
    render(<ChangesBarDiff diffs={[
      { path: 'b.ts', oldText: 'keep\nkeep old line', newText: 'keep\nkeep new line' },
    ]} labels={labels} expandLabels={expandLabels} maxLines={8} />)
    // The old line sits in the left panel with its deletion word mark; the
    // new line in the right panel with its addition word mark.
    const delMark = [...document.querySelectorAll('[class*="wordDelete"]')]
      .find(el => el.textContent === 'old')
    const addMark = [...document.querySelectorAll('[class*="wordAdd"]')]
      .find(el => el.textContent === 'new')
    expect(delMark).toBeTruthy()
    expect(addMark).toBeTruthy()
    // The header's stat counts the whole-side totals (+2 -2).
    const header = screen.getByText('b.ts').closest('[data-changes-bar-path]')
    expect(header?.querySelector('[data-changes-bar-stat]')?.textContent).toBe('+2-2')
  })

  it('collapses long context runs into expandable separators', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const after = Array.from({ length: 20 }, (_, i) => i === 10 ? `line ${i} CHANGED` : `line ${i}`).join('\n')
    render(<ChangesBarDiff diffs={[
      { path: 'ctx.ts', oldText: before, newText: after },
    ]} labels={labels} expandLabels={expandLabels} maxLines={8} />)
    // Long unchanged runs fold into separators naming the hidden lines.
    expect(screen.getByText('7 行未变更')).toBeTruthy()
    expect(screen.getByText('6 行未变更')).toBeTruthy()
    // The change bar for the modified line is present.
    expect(document.querySelector('[class*="barDelete"]')).toBeTruthy()
    expect(document.querySelector('[class*="barAdd"]')).toBeTruthy()
    // Expanding a separator reveals the hidden context (both panels).
    fireEvent.click(screen.getByText('7 行未变更'))
    expect(screen.getAllByText('line 0').length).toBeGreaterThan(0)
  })
})
