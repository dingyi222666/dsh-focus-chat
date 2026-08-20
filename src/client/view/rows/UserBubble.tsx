import { memo, useMemo } from 'react'
import { JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownCodeLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { FocusTranslate, RenderMessageImages } from '../../contract/props.ts'
import type { FocusFlowItem } from '../../model/types.ts'
import { jsonTruncated } from '../helpers/terminal.ts'
import { userImages } from '../helpers/image-labels.ts'
import { messageText, projectUserText } from '../helpers/message.tsx'
import { MessageActions } from '../chrome/MessageActions.tsx'
import css from './UserBubble.module.css'

export const MessageRow = memo(function MessageRow({ item, t, codeLabels, renderMessageImages }: {
  item: Extract<FocusFlowItem, { kind: 'message' }>
  t: FocusTranslate
  codeLabels: MarkdownCodeLabels
  renderMessageImages: RenderMessageImages
}) {
  const text = useMemo(() => messageText(item.content), [item.content])
  const images = useMemo(() => userImages(item.content), [item.content])
  const others = item.content.filter(block => block.type !== 'text' && block.type !== 'image')
  // An image-only message renders just the gallery, no bubble (the chat rule).
  const showBubble = text !== '' || others.length > 0
  return (
    <div className={css.userRow} data-role={item.role} data-time-hover-root>
      <div className={css.userStack}>
        {images.length > 0 && renderMessageImages({ images, align: 'end' })}
        {showBubble && (
          <div className={css.bubble}>
            {projectUserText(text)}
            {others.map((block, index) => (
              <JsonBlock
                key={index}
                label={t('extraBlock')}
                payload={block}
                truncatedLabel={jsonTruncated(t)}
              />
            ))}
          </div>
        )}
      </div>
      <MessageActions
        text={text}
        time={item.time}
        runMs={null}
        ttftMs={null}
        tokensPerSecond={null}
        clock="start"
        t={t}
      />
    </div>
  )
})


export const PendingSteeringBubble = memo(function PendingSteeringBubble({ content, t, renderMessageImages }: {
  content: readonly ContentBlock[]
  t: FocusTranslate
  renderMessageImages: RenderMessageImages
}) {
  const text = useMemo(() => messageText(content), [content])
  const images = useMemo(() => userImages(content), [content])
  const others = content.filter(block => block.type !== 'text' && block.type !== 'image')
  const showBubble = text !== '' || others.length > 0
  return (
    <div className={css.userRow} data-pending-steering data-time-hover-root>
      <div className={css.userStack}>
        {images.length > 0 && renderMessageImages({ images, align: 'end' })}
        {showBubble && (
          <div className={css.bubble}>
            {projectUserText(text)}
            {others.map((block, index) => (
              <JsonBlock
                key={index}
                label={t('extraBlock')}
                payload={block}
                truncatedLabel={jsonTruncated(t)}
              />
            ))}
          </div>
        )}
      </div>
      <MessageActions
        text={text}
        time={null}
        runMs={null}
        ttftMs={null}
        tokensPerSecond={null}
        clock="start"
        t={t}
      />
    </div>
  )
})

/** One command row (the chat GenericCommandCard chrome: name · settlement, expandable multiline body). */
