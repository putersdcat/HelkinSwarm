const MAX_REPLY_CHARS = 6_000;
const MULTIPART_PREFIX_RESERVE = 32;

const FAKE_ATTACHMENT_PATTERNS = [
  /attached as\s+[^\n.]+\.(md|markdown|txt|json)\.?/gi,
  /full (details|verbatim bodies|results?)\s+in attachment\.?/gi,
  /full[^\n]{0,120}in attachment\.?/gi,
  /in attachment\.?/gi,
  /see attachment\.?/gi,
];

export interface ReplyChunk {
  text: string;
  isMultipart: boolean;
  index: number;
  total: number;
}

export function splitReplyIntoChunks(message: string): ReplyChunk[] {
  const sanitizedMessage = sanitizeTeamsReplyText(message);
  const safeMessage = sanitizedMessage.trim()
    ? sanitizedMessage
    : 'I processed your request but have nothing to report back.';

  if (safeMessage.length <= MAX_REPLY_CHARS) {
    return [{ text: safeMessage, isMultipart: false, index: 0, total: 1 }];
  }

  const payloadLimit = MAX_REPLY_CHARS - MULTIPART_PREFIX_RESERVE;
  const rawChunks = chunkText(safeMessage, payloadLimit);

  return rawChunks.map((chunk, index) => ({
    text: `(part ${index + 1}/${rawChunks.length})\n\n${chunk}`,
    isMultipart: true,
    index,
    total: rawChunks.length,
  }));
}

function chunkText(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > limit) {
    const splitAt = findSplitPoint(remaining, limit);
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function findSplitPoint(text: string, limit: number): number {
  const paragraphBreak = text.lastIndexOf('\n\n', limit);
  if (paragraphBreak >= Math.floor(limit * 0.6)) {
    return paragraphBreak;
  }

  const lineBreak = text.lastIndexOf('\n', limit);
  if (lineBreak >= Math.floor(limit * 0.6)) {
    return lineBreak;
  }

  const sentenceBreak = Math.max(
    text.lastIndexOf('. ', limit),
    text.lastIndexOf('! ', limit),
    text.lastIndexOf('? ', limit),
  );
  if (sentenceBreak >= Math.floor(limit * 0.6)) {
    return sentenceBreak + 1;
  }

  const wordBreak = text.lastIndexOf(' ', limit);
  if (wordBreak >= Math.floor(limit * 0.6)) {
    return wordBreak;
  }

  return limit;
}

export const replyChunkingInternals = {
  chunkText,
  findSplitPoint,
  MAX_REPLY_CHARS,
};

export function sanitizeTeamsReplyText(message: string): string {
  let sanitized = message;
  for (const pattern of FAKE_ATTACHMENT_PATTERNS) {
    sanitized = sanitized.replace(
      pattern,
      'I cannot attach files in Teams yet in this path — I will keep the reply inline and trimmed honestly.',
    );
  }
  return sanitized;
}