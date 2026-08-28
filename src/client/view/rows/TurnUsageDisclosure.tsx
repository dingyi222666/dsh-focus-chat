import { memo, useState } from 'react'
import { DisclosureRow, IconDataOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnTokenUsage } from '@deepseek-ai/dsh-client-ui-chat/src/client/contract/chat-nodes.ts'
import type { FocusTranslate } from '../../contract/props.ts'
import css from './TurnUsageDisclosure.module.css'

/** Compact token count: 517 / 12.2K / 517K / 1.2M (the official reading). */
function formatTokens(value: number, t: FocusTranslate): string {
  const scaled = (candidate: number): string =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('number.thousand', { value: scaled(value / 1_000) })
  return t('number.million', { value: scaled(value / 1_000_000) })
}

/** Exact integer token count with digit grouping (the official reading). */
function formatExactTokens(value: number, t: FocusTranslate): string {
  const digits = String(value)
  const groups: string[] = []
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end))
  }
  return groups.join(t('number.groupSeparator'))
}

/** Display-ready cache-hit share, one decimal; a partial hit never reads 100. */
function cacheHitPercent(cacheReadTokens: number, promptTokens: number): string | null {
  if (promptTokens <= 0) return null
  if (cacheReadTokens >= promptTokens) return '100'
  const percent = Math.round((cacheReadTokens / promptTokens) * 1_000) / 10
  return percent >= 100 ? '99.9' : String(percent)
}

/** Compact per-Turn usage summary with an opt-in bucket breakdown (the
 *  official TurnUsageDisclosure chrome: data icon, summary line, and the
 *  exact bucket list on expand). */
export const TurnUsageDisclosure = memo(function TurnUsageDisclosure({ usage, t }: {
  usage: TurnTokenUsage
  t: FocusTranslate
}) {
  const [open, setOpen] = useState(false)
  const cacheHit = usage.cacheReadTokens === undefined
    ? null
    : cacheHitPercent(usage.cacheReadTokens, usage.totalTokens - usage.outputTokens)
  const total = formatTokens(usage.totalTokens, t)
  const summary = cacheHit === null
    ? total
    : t('turnUsage.summaryWithCache', { total, percent: cacheHit })
  const routes = usage.routes?.map(route => `${route.provider}/${route.model}`).join(', ') ?? ''

  return (
    <DisclosureRow
      icon={<IconDataOutline16 />}
      title={t('turnUsage.title')}
      open={open}
      expandable
      onToggle={() => { setOpen(value => !value) }}
      expandOnRowClick
      keepContentWhenOpen
      collapsedContent={(
        <>
          <span className={css.separator} aria-hidden />
          <span className={css.summary}>{summary}</span>
        </>
      )}
      className={css.root}
      chevronClassName={css.chevron}
    >
      <dl className={css.details} data-turn-usage-details>
        {routes !== '' && (
          <>
            <dt>{t('turnUsage.model')}</dt>
            <dd className={css.route}>{routes}</dd>
          </>
        )}
        <dt>{t('turnUsage.input')}</dt>
        <dd>{t('turnUsage.count', { count: formatExactTokens(usage.uncachedInputTokens, t) })}</dd>
        {usage.cacheReadTokens !== undefined && (
          <>
            <dt>{t('turnUsage.cacheRead')}</dt>
            <dd>{t('turnUsage.count', { count: formatExactTokens(usage.cacheReadTokens, t) })}</dd>
          </>
        )}
        {usage.cacheWriteTokens !== undefined && (
          <>
            <dt>{t('turnUsage.cacheWrite')}</dt>
            <dd>{t('turnUsage.count', { count: formatExactTokens(usage.cacheWriteTokens, t) })}</dd>
          </>
        )}
        <dt>{t('turnUsage.output')}</dt>
        <dd>
          {t('turnUsage.count', { count: formatExactTokens(usage.outputTokens, t) })}
          {usage.reasoningTokens !== undefined && (
            <span className={css.reasoning}>
              {t('turnUsage.reasoning', { tokens: t('turnUsage.count', { count: formatExactTokens(usage.reasoningTokens, t) }) })}
            </span>
          )}
        </dd>
        <dt className={css.totalLabel}>{t('turnUsage.total')}</dt>
        <dd className={css.totalValue}>{t('turnUsage.count', { count: formatExactTokens(usage.totalTokens, t) })}</dd>
      </dl>
    </DisclosureRow>
  )
})
