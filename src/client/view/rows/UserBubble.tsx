import { memo, useMemo } from 'react'
import { fileExtension, fileSizeText, FileTypeIcon, JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { PendingSubmission } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { FocusTranslate } from '../../contract/props.ts'
import type { FocusFlowItem } from '../../model/types.ts'
import { jsonTruncated } from '../helpers/terminal.ts'
import { messageImageLabels, userFiles, userImages } from '../helpers/image-labels.ts'
import { messageText, projectUserText } from '../helpers/message.tsx'
import { ImageGallery, type ImageLoader } from '../chrome/MessageImage.tsx'
import { MessageActions } from '../chrome/MessageActions.tsx'
import css from './UserBubble.module.css'

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
function contentParts(content: readonly ContentBlock[]): {
  text: string
  images: readonly ImageAttachmentRef[]
  files: readonly FileAttachmentRef[]
  others: readonly ContentBlock[]
} {
  return {
    text: messageText(content),
    images: userImages(content).map(image => image.attachment),
    files: userFiles(content),
    others: content.filter(block => block.type !== 'text' && block.type !== 'image' && block.type !== 'file'),
  }
}

/** The message body: the attachment lane above the bubble (the chat row shape).
 *  One message renders either the caption bubble, the attachment lane, or
 *  both; an attachment-only message shows the lane without a bubble shell. */
function MessageBody({ text, images, files, others, t, loadImage, align }: {
  text: string
  images: readonly ImageAttachmentRef[]
  files: readonly FileAttachmentRef[]
  others: readonly ContentBlock[]
  t: FocusTranslate
  loadImage: ImageLoader
  align: 'start' | 'end'
}) {
  const attachments = images.length + files.length
  const showBubble = text !== '' || others.length > 0
  return (
    <>
      {attachments > 0 && (
        <div className={css.attachmentRow} data-message-attachments>
          {images.map((image, index) => (
            // One gallery call per image: a message mixing images and files
            // forces the compact tile on each (the chat compact rule).
            <ImageGallery
              key={`image:${index}`}
              images={[{ attachment: image }]}
              load={loadImage}
              align={align}
              labels={messageImageLabels(t)}
              compact={attachments > 1}
            />
          ))}
          {files.map((file, index) => <FileCard key={`file:${index}`} file={file} />)}
        </div>
      )}
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
    </>
  )
}

export const MessageRow = memo(function MessageRow({ item, t, mdLabels, loadImage }: {
  item: Extract<FocusFlowItem, { kind: 'message' }>
  t: FocusTranslate
  mdLabels: MarkdownLabels
  loadImage: ImageLoader
}) {
  const { text, images, files, others } = useMemo(() => contentParts(item.content), [item.content])
  return (
    <div className={css.userRow} data-role={item.role} data-time-hover-root>
      <div className={css.userStack}>
        <MessageBody text={text} images={images} files={files} others={others} t={t} loadImage={loadImage} align="end" />
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


export const PendingSteeringBubble = memo(function PendingSteeringBubble({ content, t, loadImage }: {
  content: readonly ContentBlock[]
  t: FocusTranslate
  loadImage: ImageLoader
}) {
  const { text, images, files, others } = useMemo(() => contentParts(content), [content])
  return (
    <div className={css.userRow} data-pending-steering data-time-hover-root>
      <div className={css.userStack}>
        <MessageBody text={text} images={images} files={files} others={others} t={t} loadImage={loadImage} align="end" />
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
export const PendingSubmissionBubble = memo(function PendingSubmissionBubble({ submission, t }: {
  submission: PendingSubmission
  t: FocusTranslate
}) {
  const files = useMemo(
    () => submission.attachments.flatMap(attachment => attachment.type === 'file' ? [attachment.value] : []),
    [submission.attachments],
  )
  const text = submission.text
  return (
    <div className={css.userRow} data-pending-submission={submission.placement} data-time-hover-root>
      <div className={css.userStack}>
        {files.length > 0 && (
          <div className={css.attachmentRow} data-message-attachments>
            {files.map((file, index) => <FileCard key={`file:${index}`} file={file} />)}
          </div>
        )}
        {text !== '' && <div className={css.bubble}>{text}</div>}
      </div>
      <MessageActions text={text} time={submission.time} clock="start" t={t} />
    </div>
  )
})
