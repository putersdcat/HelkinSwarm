interface QuotedReplyOptions {
  targetMessageId: string;
  message: string;
  quotedPreview?: string;
}

export function buildQuotedReplyRequest(
  options: QuotedReplyOptions,
): {
  messageIds: string[];
  replyMessage: {
    body: {
      contentType: 'text';
      content: string;
    };
  };
} {
  return {
    messageIds: [options.targetMessageId],
    replyMessage: {
      body: {
        contentType: 'text',
        content: options.message,
      },
    },
  };
}