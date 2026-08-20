/** Message-image label bridge and block extraction (the chat image-labels rule). */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { FocusTranslate } from '../../contract/props.ts'
import type { MessageImageLabels } from '../chrome/MessageImage.tsx'
import type { ImageLightboxLabels } from '../chrome/ImageLightbox.tsx'

export function lightboxLabels(t: FocusTranslate): ImageLightboxLabels {
  return { dialog: t('image.preview'), close: t('image.closePreview') }
}

/** The message-image strings, including the forwarded lightbox strings. */
export function messageImageLabels(t: FocusTranslate): MessageImageLabels {
  return {
    image: t('image.label'),
    open: t('image.openOriginal'),
    openNamed: label => t('image.openOriginalLabel', { label }),
    loading: t('image.loading'),
    loadFailed: t('image.loadFailed'),
    lightbox: lightboxLabels(t),
  }
}

/** Image blocks of one user message, in order (the chat gallery's input). */
export function userImages(content: readonly ContentBlock[]): { attachment: ImageAttachmentRef }[] {
  const images: { attachment: ImageAttachmentRef }[] = []
  for (const block of content) {
    if (block.type === 'image') images.push({ attachment: block.attachment })
  }
  return images
}
