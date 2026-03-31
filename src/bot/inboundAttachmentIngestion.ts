import type { Attachment } from 'botbuilder';
import { z } from 'zod';
import {
  buildRuntimeAssetPromptSummary,
  persistRuntimeAsset,
  type RuntimeAssetReference,
} from '../integrations/runtimeAssetStore.js';

export interface IngestTeamsAttachmentsInput {
  userId: string;
  correlationId: string;
  conversationId?: string;
  messageId?: string;
  attachments?: Attachment[];
  fetchImpl?: typeof fetch;
  getBotToken?: () => Promise<string>;
}

export interface IngestTeamsAttachmentsResult {
  runtimeAssets: RuntimeAssetReference[];
  imageUrls: string[];
  notices: string[];
}

const TeamsFileDownloadInfoSchema = z.object({
  downloadUrl: z.string().url(),
  uniqueId: z.string().min(1).optional(),
  fileType: z.string().min(1).optional(),
  etag: z.string().min(1).optional(),
});

const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_RUNTIME_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const INBOUND_ATTACHMENT_TIMEOUT_MS = 15_000;

function isIgnorableAttachment(contentType: string | undefined): boolean {
  const normalized = (contentType ?? '').toLowerCase();
  return normalized === 'messagereference'
    || normalized.includes('adaptive')
    || normalized.includes('signin')
    || normalized === 'application/vnd.microsoft.teams.card.file.consent'
    || normalized === 'application/vnd.microsoft.teams.card.file.info';
}

function buildDataUrl(contentType: string, bytes: Uint8Array): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
}

function deriveAttachmentName(attachment: Attachment): string | undefined {
  return typeof attachment.name === 'string' && attachment.name.trim().length > 0
    ? attachment.name.trim()
    : undefined;
}

async function downloadWithOptionalAuth(
  url: string,
  fetchImpl: typeof fetch,
  botToken?: string,
): Promise<Response> {
  const authHeaders = botToken ? { Authorization: `Bearer ${botToken}` } : undefined;
  try {
    return await fetchImpl(url, {
      headers: authHeaders,
      signal: AbortSignal.timeout(INBOUND_ATTACHMENT_TIMEOUT_MS),
    });
  } catch {
    if (!botToken) {
      throw new Error(`Attachment download failed for ${url}`);
    }

    return await fetchImpl(url, {
      signal: AbortSignal.timeout(INBOUND_ATTACHMENT_TIMEOUT_MS),
    });
  }
}

export async function ingestTeamsAttachments(
  input: IngestTeamsAttachmentsInput,
): Promise<IngestTeamsAttachmentsResult> {
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) {
    return { runtimeAssets: [], imageUrls: [], notices: [] };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const runtimeAssets: RuntimeAssetReference[] = [];
  const imageUrls: string[] = [];
  const notices: string[] = [];

  let botToken: string | undefined;
  let botTokenLoaded = false;

  for (const attachment of attachments) {
    const contentType = attachment.contentType ?? 'application/octet-stream';
    if (isIgnorableAttachment(contentType)) {
      continue;
    }

    const normalizedType = contentType.toLowerCase();
    const fileName = deriveAttachmentName(attachment);
    const sourceBase = {
      channel: 'teams' as const,
      conversationId: input.conversationId,
      messageId: input.messageId,
    };

    let attachmentBytes: Buffer | null = null;
    let attachmentKind: 'inline-image' | 'file-download' | 'generic-attachment' = 'generic-attachment';
    let sourceUrl: string | undefined;

    if (normalizedType.startsWith('image/') && attachment.contentUrl) {
      attachmentKind = 'inline-image';
      sourceUrl = attachment.contentUrl;
      if (!botTokenLoaded && input.getBotToken) {
        botToken = await input.getBotToken();
        botTokenLoaded = true;
      }
      const response = await downloadWithOptionalAuth(sourceUrl, fetchImpl, botToken);
      if (!response.ok) {
        notices.push(`Skipped image attachment \`${fileName ?? sourceUrl}\`: download failed with ${response.status}.`);
        continue;
      }
      attachmentBytes = Buffer.from(await response.arrayBuffer());
    } else if (normalizedType === 'application/vnd.microsoft.teams.file.download.info') {
      const parsed = TeamsFileDownloadInfoSchema.safeParse(attachment.content);
      if (!parsed.success) {
        notices.push(`Skipped Teams file attachment \`${fileName ?? 'unknown file'}\`: missing downloadUrl metadata.`);
        continue;
      }
      attachmentKind = 'file-download';
      sourceUrl = parsed.data.downloadUrl;
      const response = await downloadWithOptionalAuth(sourceUrl, fetchImpl);
      if (!response.ok) {
        notices.push(`Skipped file attachment \`${fileName ?? parsed.data.downloadUrl}\`: download failed with ${response.status}.`);
        continue;
      }
      attachmentBytes = Buffer.from(await response.arrayBuffer());
    } else if (attachment.contentUrl) {
      sourceUrl = attachment.contentUrl;
      if (!botTokenLoaded && input.getBotToken) {
        botToken = await input.getBotToken();
        botTokenLoaded = true;
      }
      const response = await downloadWithOptionalAuth(sourceUrl, fetchImpl, botToken);
      if (!response.ok) {
        notices.push(`Skipped attachment \`${fileName ?? sourceUrl}\`: download failed with ${response.status}.`);
        continue;
      }
      attachmentBytes = Buffer.from(await response.arrayBuffer());
    } else {
      notices.push(`Skipped attachment \`${fileName ?? contentType}\`: no downloadable content URL was provided.`);
      continue;
    }

    if (attachmentBytes.byteLength > MAX_RUNTIME_ATTACHMENT_BYTES) {
      notices.push(`Skipped attachment \`${fileName ?? 'unnamed'}\`: ${attachmentBytes.byteLength} bytes exceeds the ${MAX_RUNTIME_ATTACHMENT_BYTES} byte runtime attachment limit.`);
      continue;
    }

    const reference = await persistRuntimeAsset({
      userId: input.userId,
      correlationId: input.correlationId,
      bytes: new Uint8Array(attachmentBytes),
      contentType,
      ...(fileName ? { fileName } : {}),
      source: {
        ...sourceBase,
        attachmentKind,
        ...(sourceUrl ? { externalId: sourceUrl } : {}),
        detail: `teams:${attachmentKind}`,
      },
      summary: `Inbound Teams ${attachmentKind} attachment.${fileName ? ` Original filename: ${fileName}.` : ''}`,
    });

    if (!reference) {
      notices.push(`Skipped attachment \`${fileName ?? 'unnamed'}\`: runtime asset storage is unavailable.`);
      continue;
    }

    runtimeAssets.push(reference);

    if (attachmentKind === 'inline-image' && attachmentBytes.byteLength <= MAX_INLINE_IMAGE_BYTES) {
      imageUrls.push(buildDataUrl(contentType, attachmentBytes));
    }
  }

  return { runtimeAssets, imageUrls, notices };
}

export function buildInboundAttachmentPromptBlock(
  runtimeAssets: RuntimeAssetReference[],
  notices: string[] = [],
): string {
  const sections: string[] = [];

  if (runtimeAssets.length > 0) {
    sections.push(
      'Inbound runtime assets for this turn:',
      ...runtimeAssets.map((asset) => {
        const kind = asset.source.attachmentKind ?? 'generic-attachment';
        return `- Attachment kind: ${kind}. ${buildRuntimeAssetPromptSummary(asset)}`;
      }),
    );
  }

  if (notices.length > 0) {
    sections.push('Attachment ingestion notices:', ...notices.map((notice) => `- ${notice}`));
  }

  return sections.join('\n');
}