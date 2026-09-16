import { memo, useMemo } from 'react'
import { fileExtension, fileSizeText, FileTypeIcon, JsonBlock, projectUserText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels, UserTextReferences } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusFlowItem } from '../../model/types.ts'
import { jsonTruncated } from '../helpers/terminal.ts'
import { messageImageLabels, userFiles, userImages } from '../helpers/image-labels.ts'
import { messageText } from '../helpers/message.tsx'
import { ImageGallery, type ImageLoader, type MessageImageSpec } from '../chrome/MessageImage.tsx'
import { MessageActions } from '../chrome/MessageActions.tsx'
import css from './UserBubble.module.css'

/// Shared empty label list (stable identity for memoized rows).
const EMPTY_LABELS: readonly string[] = []

/** One file card in the attachment lane (the chat file-card chrome). */
function FileCard({ file }: { file: FileAttachmentRef }) {
  const meta = [fileExtension(file.name).toUpperCase().slice(0, 8), fileSizeText(file.bytes)].filter(Boolean).join(' ')
  return (
    <span className={css.fileCard} title={file.name}>
      <FileTypeIcon path={file.name} className={css.fileIcon} />
      <span className={css.fileContent}>
        <span className={css.fileName}>{file.name}</span>
        <span className={css.fileMeta}>{meta}</span>
      </span>
    </span>
  )
}

/** The bubble's content split: caption text, attachment blocks, and the rest
 *  (a `file` block joins the attachment lane; anything else is an extra block). */
type PresentedAttachment =
  | { readonly type: 'image'; readonly attachment: ImageAttachmentRef }
  | { readonly type: 'file'; readonly file: FileAttachmentRef }

function contentParts(content: readonly ContentBlock[]): {
  text: string
  attachments: readonly PresentedAttachment[]
  others: readonly ContentBlock[]
} {
  // Attachments keep their authored order (the official contentParts rule):
  // an image after a file stays after it in the lane.
  const attachments: PresentedAttachment[] = []
  for (const block of content) {
    if (block.type === 'image') attachments.push({ type: 'image', attachment: block.attachment })
    else if (block.type === 'file') attachments.push({ type: 'file', file: block.attachment })
  }
  return {
    text: messageText(content),
    attachments,
    others: content.filter(block => block.type !== 'text' && block.type !== 'image' && block.type !== 'file'),
  }
}

/** The message body: the attachment lane above the bubble (the chat row shape).
 *  One message renders either the caption bubble, the attachment lane, or
 *  both; an attachment-only message shows the lane without a bubble shell. */
function MessageBody({ text, attachments, others, referenceLabels, skillNames, references, t, loadImage, align }: {
  text: string
  attachments: readonly PresentedAttachment[]
  others: readonly ContentBlock[]
  referenceLabels: readonly string[]
  skillNames: readonly string[]
  /** File and skill preview actions: the chip arms the chat turns into buttons. */
  references: UserTextReferences
  t: FocusTranslate
  loadImage: ImageLoader
  align: 'start' | 'end'
}) {
  const count = attachments.length
  const showBubble = text !== '' || others.length > 0
  return (
    <>
      {count > 0 && (
        <div className={css.attachmentRow} data-message-attachments>
          {attachments.map((attachment, index) => attachment.type === 'image'
            ? (
              // One gallery call per image: a message mixing images and files
              // forces the compact tile on each (the chat compact rule).
              <ImageGallery
                key={`image:${index}`}
                images={[{ attachment: attachment.attachment }]}
                load={loadImage}
                align={align}
                labels={messageImageLabels(t)}
                compact={count > 1}
              />
            )
            : <FileCard key={`file:${index}`} file={attachment.file} />)}
        </div>
      )}
      {showBubble && (
        <div className={css.bubble}>
          {projectUserText(text, referenceLabels, skillNames, 'skill', references)}
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
      {referenceLabels.length > 0 && (
        <div className={css.referenceSummary}>
          {t('message.referenceSummary', {
            labels: referenceLabels.join(t('message.referenceSeparator')),
          })}
        </div>
      )}
    </>
  )
}

export const MessageRow = memo(function MessageRow({ item, t, mdLabels, loadImage, references }: {
  item: Extract<FocusFlowItem, { kind: 'message' }>
  t: FocusTranslate
  mdLabels: MarkdownLabels
  loadImage: ImageLoader
  /** File and skill preview actions for the bubble's reference chips. */
  references: UserTextReferences
}) {
  const { text, attachments, others } = useMemo(() => contentParts(item.content), [item.content])
  const referenceLabels = item.referenceLabels ?? EMPTY_LABELS
  const skillNames = item.skillNames ?? EMPTY_LABELS
  return (
    <div className={css.userRow} data-role={item.role} data-time-hover-root>
      <div className={css.userStack}>
        <MessageBody
          text={text}
          attachments={attachments}
          others={others}
          referenceLabels={referenceLabels}
          skillNames={skillNames}
          references={references}
          t={t}
          loadImage={loadImage}
          align="end"
        />
      </div>
      <MessageActions
        text={text}
        time={item.time}
        clock="start"
        t={t}
      />
    </div>
  )
})


export const PendingSteeringBubble = memo(function PendingSteeringBubble({ content, t, loadImage, references }: {
  content: readonly ContentBlock[]
  t: FocusTranslate
  loadImage: ImageLoader
  /** File and skill preview actions for the bubble's reference chips. */
  references: UserTextReferences
}) {
  const { text, attachments, others } = useMemo(() => contentParts(content), [content])
  return (
    <div className={css.userRow} data-pending-steering data-time-hover-root>
      <div className={css.userStack}>
        <MessageBody
          text={text}
          attachments={attachments}
          others={others}
          referenceLabels={EMPTY_LABELS}
          skillNames={EMPTY_LABELS}
          references={references}
          t={t}
          loadImage={loadImage}
          align="end"
        />
      </div>
      <MessageActions
        text={text}
        time={null}
        clock="start"
        t={t}
      />
    </div>
  )
})


/**
 * One local prompt-submission echo: the message the human just sent, shown
 * before serialization and durable admission complete (the official
 * PendingSubmissionBubble shape). Image previews ride the submitter's own
 * object URLs, so only text and durable file attachments render here.
 */
export const PendingSubmissionBubble = memo(function PendingSubmissionBubble({ submission, t, loadImage }: {
  submission: PendingSubmission
  t: FocusTranslate
  loadImage: ImageLoader
}) {
  const files = useMemo(
    () => submission.attachments.flatMap(attachment => attachment.type === 'file' ? [attachment.value] : []),
    [submission.attachments],
  )
  // Image previews are browser-owned object URLs: the gallery's preview arm
  // displays them directly, no loader round-trip.
  const images = useMemo<readonly MessageImageSpec[]>(
    () => submission.attachments.flatMap(attachment => attachment.type === 'image'
      ? [{
        preview: {
          url: attachment.value.previewUrl,
          ...(attachment.value.name === undefined ? {} : { name: attachment.value.name }),
          ...(attachment.value.width === undefined ? {} : { width: attachment.value.width }),
          ...(attachment.value.height === undefined ? {} : { height: attachment.value.height }),
        },
      }]
      : []),
    [submission.attachments],
  )
  const text = submission.text
  return (
    <div className={css.userRow} data-pending-submission={submission.placement} data-time-hover-root>
      <div className={css.userStack}>
        {(images.length > 0 || files.length > 0) && (
          <div className={css.attachmentRow} data-message-attachments>
            {images.length > 0 && (
              <ImageGallery
                images={images}
                load={loadImage}
                align="end"
                labels={messageImageLabels(t)}
                // A mixed row renders every image as a tile (the attachments-row rule).
                compact={files.length > 0}
              />
            )}
            {files.map((file, index) => <FileCard key={`file:${index}`} file={file} />)}
          </div>
        )}
        {text !== '' && <div className={css.bubble}>{text}</div>}
      </div>
      <MessageActions text={text} time={submission.time} clock="start" t={t} />
    </div>
  )
})
