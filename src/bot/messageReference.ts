interface MessageReferenceContent {
  messageId?: unknown;
  messagePreview?: unknown;
}

interface MessageReferenceAttachment {
  contentType?: unknown;
  content?: unknown;
  cardPayload?: unknown;
}

function isMessageReferenceContentType(contentType: unknown): boolean {
  if (typeof contentType !== 'string') {
    return false;
  }

  const normalized = contentType.trim().toLowerCase();
  return normalized === 'messagereference'
    || normalized === 'message-reference'
    || normalized.endsWith('.messagereference')
    || normalized.endsWith('.message-reference');
}

function getMessageReferenceContent(
  attachment: MessageReferenceAttachment,
): MessageReferenceContent | undefined {
  if (!isMessageReferenceContentType(attachment.contentType)) {
    return undefined;
  }

  if (attachment.content && typeof attachment.content === 'object') {
    return attachment.content as MessageReferenceContent;
  }

  if (attachment.cardPayload && typeof attachment.cardPayload === 'object') {
    return attachment.cardPayload as MessageReferenceContent;
  }

  return undefined;
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