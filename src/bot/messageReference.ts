interface MessageReferenceContent {
  messageId?: unknown;
  messagePreview?: unknown;
}

interface MessageReferenceAttachment {
  contentType?: unknown;
  content?: unknown;
}

function getMessageReferenceContent(
  attachment: MessageReferenceAttachment,
): MessageReferenceContent | undefined {
  if (attachment.contentType !== 'messageReference') {
    return undefined;
  }

  if (!attachment.content || typeof attachment.content !== 'object') {
    return undefined;
  }

  return attachment.content as MessageReferenceContent;
}

export function extractMessageReferenceId(
  attachments: ReadonlyArray<MessageReferenceAttachment> | undefined,
): string | undefined {
  if (!attachments) {
    return undefined;
  }

  for (const attachment of attachments) {
    const content = getMessageReferenceContent(attachment);
    if (typeof content?.messageId === 'string' && content.messageId.trim().length > 0) {
      return content.messageId;
    }
  }

  return undefined;
}

export function extractMessageReferencePreview(
  attachments: ReadonlyArray<MessageReferenceAttachment> | undefined,
): string | undefined {
  if (!attachments) {
    return undefined;
  }

  for (const attachment of attachments) {
    const content = getMessageReferenceContent(attachment);
    if (typeof content?.messagePreview === 'string' && content.messagePreview.trim().length > 0) {
      return content.messagePreview.trim();
    }
  }

  return undefined;
}