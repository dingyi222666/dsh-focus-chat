/**
 * Host boot safety: the focus loader must never abort the profile boot when an
 * optional host capability refuses a registration (the connection registry's
 * owner-context webServer defect, or a settings namespace clash). Each
 * registration degrades to a warning instead of a thrown load failure.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

/** One recorded logger line. */
interface LogLine {
  readonly name: string
  readonly args: readonly unknown[]
}

/** One stub host context plus the observations the specs assert on. */
interface BootStub {
  readonly ctx: Context
  readonly warnings: LogLine[]
  /** Run every effect body `apply` deferred (the loader's registration pass). */
  runEffects(): unknown[]
}

/** Build one stub host context carrying the slice of Context `apply` touches. */
function stubContext(options: {
  connection?: unknown
  settingsRegister?: () => void
} = {}): BootStub {
  const warnings: LogLine[] = []
  const effects: (() => unknown)[] = []
  const settings = {
    register: () => { options.settingsRegister?.() },
  }
  const make = (withSettings: boolean): Record<string, unknown> => ({
    effect: (callback: () => unknown) => { effects.push(callback); return undefined },
    inject: (_names: readonly string[], callback: (ctx: unknown) => void) => {
      callback(make(true))
      return undefined
    },
    get: (name: string) => (name === 'connection' ? options.connection : undefined),
    logger: (name = '') => ({
      warn: (...args: unknown[]) => { warnings.push({ name, args }) },
    }),
    ...withSettings ? { settings } : {},
  })
  return {
    ctx: make(false) as unknown as Context,
    warnings,
    runEffects: () => effects.map(callback => callback()),
  }
}

/** The RPC registry shape the loader consumes. */
const registry = { rpc: { handle: () => async (): Promise<void> => {} } }

describe('focus host boot safety', () => {
  it('degrades to a warning when the connection registry rejects the channel', () => {
    const boot = stubContext({
      connection: {
        rpc: {
          handle: () => { throw new Error('cannot get property "webServer" without inject') },
        },
      },
    })

    expect(() => { apply(boot.ctx) }).not.toThrow()
    expect(() => boot.runEffects()).not.toThrow()
    expect(boot.warnings).toHaveLength(1)
    expect(boot.warnings[0]?.name).toBe('dsh-focus-chat')
    expect(String(boot.warnings[0]?.args[0])).toContain('focus rpc channel registration failed')
    expect(String(boot.warnings[0]?.args[1])).toContain('without inject')
  })

  it('degrades to a warning when the connection service is absent', () => {
    const boot = stubContext({})

    expect(() => { apply(boot.ctx) }).not.toThrow()
    expect(() => boot.runEffects()).not.toThrow()
    expect(boot.warnings).toHaveLength(1)
    expect(String(boot.warnings[0]?.args[1])).toContain('connection service is required')
  })

  it('degrades to a warning when the settings namespace cannot register', () => {
    const boot = stubContext({
      connection: registry,
      settingsRegister: () => { throw new Error('dsh-focus-chat settings namespace is already owned') },
    })

    expect(() => { apply(boot.ctx) }).not.toThrow()
    expect(boot.warnings).toHaveLength(1)
    expect(String(boot.warnings[0]?.args[0])).toContain('focus settings namespace registration failed')
    expect(String(boot.warnings[0]?.args[1])).toContain('already owned')
  })

  it('registers the channel and hands back its disposer on success', () => {
    const disposal = async (): Promise<void> => {}
    const boot = stubContext({ connection: { rpc: { handle: () => disposal } } })

    expect(() => { apply(boot.ctx) }).not.toThrow()
    expect(boot.warnings).toHaveLength(0)
    expect(boot.runEffects()).toEqual([disposal])
  })
})
