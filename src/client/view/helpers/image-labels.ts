/** Image blocks of one user message, in order (the chat gallery's input). */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'

export function userImages(content: readonly ContentBlock[]): { attachment: ImageAttachmentRef }[] {
  const images: { attachment: ImageAttachmentRef }[] = []
  for (const block of content) {
    if (block.type === 'image') images.push({ attachment: block.attachment })
  }
  return images
}
