// Outlook + Calendar skill handlers — Graph API operations on behalf of the user.
// Spec ref: 05-Capabilities-Framework.md, 06-Tool-Dispatch-LLM-Layer.md
// Issue: #117
//
// Auth: prefer real scoped/OBO delegated tokens when available.
// If the scoped token is only a placeholder, fall back to the legacy Bot Framework
// OAuth connection token cached by manual /link in the Bot Token Service.

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getGraphTokenForUser } from '../../src/auth/graphTokenHelper.js';
import { isPlaceholderScopedToken } from '../../src/auth/scopedTokenMinter.js';
import { registerHandler } from '../../src/capabilities/capabilityLoader.js';
import { trackEvent } from '../../src/observability/telemetry.js';
import { persistRuntimeAsset } from '../../src/integrations/runtimeAssetStore.js';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Resolve a Graph API token from handler args.
 * Prefers scoped token injected by orchestrator (#318).
 * Falls back to the legacy Bot Framework cached token path when no real OBO/scoped token is available.
 */
async function resolveToken(args: Record<string, unknown>): Promise<string> {
  const correlationId = typeof args['correlationId'] === 'string' ? args['correlationId'] : 'outlook-handler';
  const userId = typeof args['userId'] === 'string' ? args['userId'] : undefined;
  const scopedToken = typeof args['_scopedToken'] === 'string' ? args['_scopedToken'] : undefined;

  if (scopedToken && !isPlaceholderScopedToken(scopedToken)) {
    trackEvent({
      name: 'HandlerTokenSource',
      correlationId,
      userId,
      properties: {
        handler: 'outlook',
        source: 'scoped',
        scope: String(args['_scopedTokenScope'] ?? 'unknown'),
        method: String(args['_scopedTokenMethod'] ?? 'unknown'),
      },
    });
    return scopedToken;
  }

  if (scopedToken && isPlaceholderScopedToken(scopedToken)) {
    trackEvent({
      name: 'HandlerTokenSource',
      correlationId,
      userId,
      properties: {
        handler: 'outlook',
        source: 'legacy-fallback',
        reason: 'placeholder-scoped-token',
        scope: String(args['_scopedTokenScope'] ?? 'unknown'),
      },
    });
  }

  const token = await getGraphTokenForUser(args['userId'] as string);
  if (!token) throw new Error('No Graph token available. Please run /link first to connect your Microsoft account.');
  trackEvent({
    name: 'HandlerTokenSource',
    correlationId,
    userId,
    properties: {
      handler: 'outlook',
      source: 'legacy',
    },
  });
  return token;
}

async function graphFetch<T>(
  token: string,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Graph API ${response.status}: ${errorBody}`);
  }

  const data = await response.json() as unknown;
  return schema.parse(data);
}

// ---------------------------------------------------------------------------
// Zod schemas for Graph API response validation
// ---------------------------------------------------------------------------

const EmailAddressSchema = z.object({
  name: z.string().optional(),
  address: z.string(),
});

const RecipientSchema = z.object({
  emailAddress: EmailAddressSchema,
});

const MessageSchema = z.object({
  id: z.string(),
  subject: z.string().nullable().optional(),
  bodyPreview: z.string().nullable().optional(),
  body: z.object({
    contentType: z.string(),
    content: z.string(),
  }).optional(),
  from: RecipientSchema.nullable().optional(),
  toRecipients: z.array(RecipientSchema).default([]),
  ccRecipients: z.array(RecipientSchema).default([]),
  receivedDateTime: z.string().nullable().optional(),
  isRead: z.boolean().optional(),
  hasAttachments: z.boolean().optional(),
}).passthrough();

const MessageListSchema = z.object({
  value: z.array(MessageSchema),
}).passthrough();

const OutlookAttachmentSchema = z.object({
  '@odata.type': z.string().optional(),
  id: z.string(),
  name: z.string().nullable().optional(),
  contentType: z.string().nullable().optional(),
  size: z.number().int().nonnegative().optional(),
  isInline: z.boolean().optional(),
  contentId: z.string().nullable().optional(),
  lastModifiedDateTime: z.string().nullable().optional(),
}).passthrough();

const OutlookAttachmentListSchema = z.object({
  value: z.array(OutlookAttachmentSchema),
}).passthrough();

const OutlookFileAttachmentSchema = OutlookAttachmentSchema.extend({
  contentBytes: z.string().nullable().optional(),
}).passthrough();

const CalendarEventSchema = z.object({
  id: z.string(),
  subject: z.string().nullable().optional(),
  organizer: z.object({
    emailAddress: EmailAddressSchema,
  }).nullable().optional(),
  start: z.object({ dateTime: z.string(), timeZone: z.string() }),
  end: z.object({ dateTime: z.string(), timeZone: z.string() }),
  location: z.object({ displayName: z.string().optional() }).nullable().optional(),
  attendees: z.array(z.object({
    emailAddress: EmailAddressSchema,
    type: z.string().optional(),
  })).default([]),
  isReminderOn: z.boolean().optional(),
  reminderMinutesBeforeStart: z.number().optional(),
  isOnlineMeeting: z.boolean().optional(),
  onlineMeetingUrl: z.string().nullable().optional(),
  bodyPreview: z.string().nullable().optional(),
}).passthrough();

const CalendarEventListSchema = z.object({
  value: z.array(CalendarEventSchema),
}).passthrough();

const CreatedEventSchema = CalendarEventSchema;

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const FOLDER_MAP: Record<string, string> = {
  inbox: 'inbox',
  sentitems: 'sentitems',
  drafts: 'drafts',
  archive: 'archive',
};

type OutlookAttachmentRecord = z.infer<typeof OutlookAttachmentSchema>;

interface OutlookAttachmentMetadata {
  id: string;
  name: string | null;
  contentType: string;
  size: number | null;
  isInline: boolean;
  contentId: string | null;
  cidReferencedInBody: boolean;
  lastModifiedDateTime: string | null;
  attachmentType: 'file' | 'item' | 'reference' | 'unknown';
  attachmentKind: 'inline-image' | 'file-download' | 'generic-attachment';
  downloadSupported: boolean;
}

function normalizeContentId(contentId: string | null | undefined): string | undefined {
  const trimmed = contentId?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/^<+/, '').replace(/>+$/, '');
}

function extractCidReferences(bodyContent: string | undefined): Set<string> {
  const references = new Set<string>();
  if (!bodyContent) {
    return references;
  }

  const cidRegex = /cid:([^"'\s>]+)/gi;
  for (const match of bodyContent.matchAll(cidRegex)) {
    const normalized = normalizeContentId(match[1]);
    if (normalized) {
      references.add(normalized.toLowerCase());
    }
  }

  return references;
}

function getAttachmentType(odataType: string | undefined): OutlookAttachmentMetadata['attachmentType'] {
  const normalized = odataType?.toLowerCase() ?? '';
  if (normalized.endsWith('fileattachment')) {
    return 'file';
  }
  if (normalized.endsWith('itemattachment')) {
    return 'item';
  }
  if (normalized.endsWith('referenceattachment')) {
    return 'reference';
  }
  return 'unknown';
}

function mapOutlookAttachmentMetadata(
  attachment: OutlookAttachmentRecord,
  cidReferences: Set<string>,
): OutlookAttachmentMetadata {
  const contentId = normalizeContentId(attachment.contentId);
  const cidReferencedInBody = !!contentId && cidReferences.has(contentId.toLowerCase());
  const attachmentType = getAttachmentType(attachment['@odata.type']);
  const isInline = attachment.isInline === true || cidReferencedInBody;
  const attachmentKind: OutlookAttachmentMetadata['attachmentKind'] = isInline
    ? 'inline-image'
    : attachmentType === 'file'
      ? 'file-download'
      : 'generic-attachment';

  return {
    id: attachment.id,
    name: attachment.name ?? null,
    contentType: attachment.contentType ?? 'application/octet-stream',
    size: attachment.size ?? null,
    isInline,
    contentId: contentId ?? null,
    cidReferencedInBody,
    lastModifiedDateTime: attachment.lastModifiedDateTime ?? null,
    attachmentType,
    attachmentKind,
    downloadSupported: attachmentType === 'file',
  };
}

async function getMessageAttachmentContext(
  token: string,
  messageId: string,
): Promise<{
  bodyCidReferences: string[];
  attachments: OutlookAttachmentMetadata[];
}> {
  const message = await graphFetch(
    token,
    `/me/messages/${encodeURIComponent(messageId)}?$select=id,body,hasAttachments`,
    MessageSchema,
  );

  const cidReferences = extractCidReferences(message.body?.content);
  if (!message.hasAttachments) {
    return {
      bodyCidReferences: Array.from(cidReferences),
      attachments: [],
    };
  }

  const attachmentResult = await graphFetch(
    token,
    `/me/messages/${encodeURIComponent(messageId)}/attachments?$top=100`,
    OutlookAttachmentListSchema,
  );

  return {
    bodyCidReferences: Array.from(cidReferences),
    attachments: attachmentResult.value.map((attachment) => mapOutlookAttachmentMetadata(attachment, cidReferences)),
  };
}

const outlookListEmails: ToolHandler = async (args) => {
  z.string().parse(args['userId']); // validate presence
  const top = Math.min(z.number().default(10).parse(args['top'] ?? 10), 50);
  const folder = z.string().default('inbox').parse(args['folder'] ?? 'inbox');
  const filter = args['filter'] as string | undefined;

  const folderPath = FOLDER_MAP[folder.toLowerCase()] ?? 'inbox';
  let path = `/me/mailFolders/${folderPath}/messages?$top=${top}&$select=id,subject,bodyPreview,from,receivedDateTime,isRead,hasAttachments&$orderby=receivedDateTime desc`;

  if (filter) {
    path += `&$filter=${encodeURIComponent(filter)}`;
  }

  const token = await resolveToken(args);
  const result = await graphFetch(token, path, MessageListSchema);

  return result.value.map((m) => ({
    id: m.id,
    subject: m.subject,
    from: m.from?.emailAddress?.address ?? 'unknown',
    fromName: m.from?.emailAddress?.name,
    receivedAt: m.receivedDateTime,
    preview: m.bodyPreview?.slice(0, 200),
    isRead: m.isRead,
    hasAttachments: m.hasAttachments,
  }));
};

const outlookReadEmail: ToolHandler = async (args) => {
  z.string().parse(args['userId']);
  const messageId = z.string().parse(args['messageId']);

  const token = await resolveToken(args);
  const result = await graphFetch(
    token,
    `/me/messages/${encodeURIComponent(messageId)}?$select=id,subject,body,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments`,
    MessageSchema,
  );

  const attachmentContext = await getMessageAttachmentContext(token, messageId);

  return {
    id: result.id,
    subject: result.subject,
    from: result.from?.emailAddress?.address,
    to: (result.toRecipients ?? []).map((r) => r.emailAddress.address),
    cc: (result.ccRecipients ?? []).map((r) => r.emailAddress.address),
    body: result.body?.content,
    bodyType: result.body?.contentType,
    receivedAt: result.receivedDateTime,
    hasAttachments: result.hasAttachments,
    bodyCidReferences: attachmentContext.bodyCidReferences,
    attachments: attachmentContext.attachments,
  };
};

const outlookListAttachments: ToolHandler = async (args) => {
  z.string().parse(args['userId']);
  const messageId = z.string().parse(args['messageId']);

  const token = await resolveToken(args);
  const attachmentContext = await getMessageAttachmentContext(token, messageId);

  return {
    messageId,
    bodyCidReferences: attachmentContext.bodyCidReferences,
    attachments: attachmentContext.attachments,
  };
};

const outlookDownloadAttachment: ToolHandler = async (args) => {
  const userId = z.string().parse(args['userId']);
  const messageId = z.string().parse(args['messageId']);
  const attachmentId = z.string().parse(args['attachmentId']);
  const correlationId = z.string().optional().parse(args['correlationId']) ?? randomUUID();

  const token = await resolveToken(args);
  const attachmentContext = await getMessageAttachmentContext(token, messageId);
  const attachmentMetadata = attachmentContext.attachments.find((attachment) => attachment.id === attachmentId);

  if (!attachmentMetadata) {
    throw new Error(`Attachment '${attachmentId}' was not found on message '${messageId}'.`);
  }

  if (!attachmentMetadata.downloadSupported) {
    throw new Error(
      `Attachment '${attachmentId}' is a ${attachmentMetadata.attachmentType} attachment and cannot be downloaded into runtime asset storage yet.`,
    );
  }

  const attachment = await graphFetch(
    token,
    `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    OutlookFileAttachmentSchema,
  );

  if (!attachment.contentBytes) {
    throw new Error(`Attachment '${attachmentId}' did not include file content.`);
  }

  const assetReference = await persistRuntimeAsset({
    userId,
    correlationId,
    contentType: attachmentMetadata.contentType,
    ...(attachmentMetadata.name ? { fileName: attachmentMetadata.name } : {}),
    bytes: Buffer.from(attachment.contentBytes, 'base64'),
    source: {
      channel: 'outlook',
      attachmentKind: attachmentMetadata.attachmentKind,
      messageId,
      externalId: attachmentId,
      detail: attachmentMetadata.isInline
        ? `outlook:inline-image:${attachmentMetadata.contentId ?? attachmentId}`
        : 'outlook:file-attachment',
    },
    summary: attachmentMetadata.isInline
      ? `Inline Outlook attachment downloaded from message ${messageId}.${attachmentMetadata.name ? ` Original filename: ${attachmentMetadata.name}.` : ''}${attachmentMetadata.contentId ? ` Content ID: ${attachmentMetadata.contentId}.` : ''}`
      : `Outlook attachment downloaded from message ${messageId}.${attachmentMetadata.name ? ` Original filename: ${attachmentMetadata.name}.` : ''}`,
  });

  if (!assetReference) {
    throw new Error('Runtime asset storage is not configured on this stamp.');
  }

  return {
    messageId,
    attachment: attachmentMetadata,
    runtimeAsset: assetReference,
  };
};

const outlookSendEmail: ToolHandler = async (args) => {
  z.string().parse(args['userId']);
  const to = z.array(z.string()).parse(args['to']);
  const subject = z.string().parse(args['subject']);
  const body = z.string().parse(args['body']);
  const bodyType = z.string().default('text').parse(args['bodyType'] ?? 'text');
  const cc = z.array(z.string()).default([]).parse(args['cc'] ?? []);

  const token = await resolveToken(args);

  const response = await fetch(`${GRAPH_BASE}/me/sendMail`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: bodyType === 'html' ? 'HTML' : 'Text', content: body },
        toRecipients: to.map((addr) => ({ emailAddress: { address: addr } })),
        ccRecipients: cc.map((addr) => ({ emailAddress: { address: addr } })),
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 403 && errorBody.includes('ErrorAccessDenied')) {
      throw new Error(
        'Outlook Graph API 403 ErrorAccessDenied — your Outlook link is present, but send permission is not usable yet. Refresh consent with /relink outlook and try again.',
      );
    }
    throw new Error(`Graph API ${response.status}: ${errorBody}`);
  }

  return { success: true, message: `Email sent to ${to.join(', ')}` };
};

const outlookReplyToLatestEmail: ToolHandler = async (args) => {
  z.string().parse(args['userId']);
  const sender = z.string().parse(args['sender']);
  const comment = z.string().parse(args['comment']);
  const replyAll = z.boolean().default(false).parse(args['replyAll'] ?? false);
  const folder = z.string().optional().parse(args['folder']);

  const folderSegment = folder
    ? `/mailFolders/${FOLDER_MAP[folder.toLowerCase()] ?? folder}/`
    : '/';
  const searchPath = `/me${folderSegment}messages?$search=${encodeURIComponent(`"from:${sender}"`)}&$top=1&$select=id,subject,from,receivedDateTime`;

  const token = await resolveToken(args);
  const latest = await graphFetch(token, searchPath, MessageListSchema);
  const target = latest.value[0];
  if (!target) {
    throw new Error(`No recent email found from ${sender}.`);
  }

  const action = replyAll ? 'replyAll' : 'reply';
  const response = await fetch(`${GRAPH_BASE}/me/messages/${encodeURIComponent(target.id)}/${action}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ comment }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 403 && errorBody.includes('ErrorAccessDenied')) {
      throw new Error(
        'Outlook Graph API 403 ErrorAccessDenied — your Outlook link is present, but send permission is not usable yet. Refresh consent with /relink outlook and try again.',
      );
    }
    throw new Error(`Graph API ${response.status}: ${errorBody}`);
  }

  return {
    success: true,
    action,
    sender: target.from?.emailAddress?.address ?? sender,
    subject: target.subject,
    receivedAt: target.receivedDateTime,
    message: `Replied to the latest email from ${target.from?.emailAddress?.address ?? sender}`,
  };
};

const outlookSearchEmails: ToolHandler = async (args) => {
  // Issue #311: Replaced /search/query (Exchange search index — latency, misses)
  // with /me/messages?$search= (direct mailbox query, reliable for sender/subject search).
  z.string().parse(args['userId']);
  const query = z.string().parse(args['query']);
  const top = Math.min(z.number().default(10).parse(args['top'] ?? 10), 25);
  const folder = z.string().optional().parse(args['folder']);

  // Build the path — optionally scope to a specific folder
  // Note: $search and $orderby cannot be combined on /me/messages (Graph limitation)
  const folderSegment = folder
    ? `/mailFolders/${FOLDER_MAP[folder.toLowerCase()] ?? folder}/`
    : '/';
  const path = `/me${folderSegment}messages?$search=${encodeURIComponent(`"${query}"`)}&$top=${top}&$select=id,subject,bodyPreview,from,receivedDateTime,isRead,hasAttachments`;

  const token = await resolveToken(args);
  const result = await graphFetch(token, path, MessageListSchema);

  return result.value.map((m) => ({
    id: m.id,
    subject: m.subject,
    from: m.from?.emailAddress?.address ?? 'unknown',
    fromName: m.from?.emailAddress?.name,
    receivedAt: m.receivedDateTime,
    preview: m.bodyPreview?.slice(0, 200),
    isRead: m.isRead,
    hasAttachments: m.hasAttachments,
  }));
};

const outlookListCalendarEvents: ToolHandler = async (args) => {
  z.string().parse(args['userId']);
  const top = z.number().default(10).parse(args['top'] ?? 10);
  const now = new Date();
  const startDateTime = z.string().default(now.toISOString()).parse(args['startDateTime'] ?? now.toISOString());
  const endDateTime = z.string().default(
    new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  ).parse(args['endDateTime'] ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString());

  const path = `/me/calendarView?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}&$top=${top}&$select=id,subject,organizer,start,end,location,attendees,isOnlineMeeting,onlineMeetingUrl,bodyPreview&$orderby=start/dateTime`;

  const token = await resolveToken(args);
  const result = await graphFetch(token, path, CalendarEventListSchema);

  return result.value.map((e) => ({
    id: e.id,
    subject: e.subject,
    organizer: e.organizer?.emailAddress?.address,
    start: e.start.dateTime,
    end: e.end.dateTime,
    timeZone: e.start.timeZone,
    location: e.location?.displayName,
    attendees: (e.attendees ?? []).map((a) => a.emailAddress.address),
    isOnlineMeeting: e.isOnlineMeeting,
    meetingUrl: e.onlineMeetingUrl,
    preview: e.bodyPreview?.slice(0, 150),
  }));
};

const outlookCreateCalendarEvent: ToolHandler = async (args) => {
  z.string().parse(args['userId']);
  const subject = z.string().parse(args['subject']);
  const start = z.string().parse(args['start']);
  const end = z.string().parse(args['end']);
  const location = args['location'] as string | undefined;
  const body = args['body'] as string | undefined;
  const attendees = z.array(z.string()).default([]).parse(args['attendees'] ?? []);
  const reminderMinutesBeforeStart = args['reminderMinutesBeforeStart'] === undefined
    ? undefined
    : z.number().int().min(0).max(40320).parse(args['reminderMinutesBeforeStart']);
  const isReminderOn = args['isReminderOn'] === undefined
    ? reminderMinutesBeforeStart !== undefined
    : z.boolean().parse(args['isReminderOn']);
  const isOnlineMeeting = z.boolean().default(false).parse(args['isOnlineMeeting'] ?? false);

  const token = await resolveToken(args);

  const response = await fetch(`${GRAPH_BASE}/me/events`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject,
      start: { dateTime: start, timeZone: 'UTC' },
      end: { dateTime: end, timeZone: 'UTC' },
      ...(location ? { location: { displayName: location } } : {}),
      ...(body ? { body: { contentType: 'Text', content: body } } : {}),
      attendees: attendees.map((addr) => ({
        emailAddress: { address: addr },
        type: 'required',
      })),
      ...(reminderMinutesBeforeStart !== undefined ? { reminderMinutesBeforeStart } : {}),
      ...(args['isReminderOn'] !== undefined || reminderMinutesBeforeStart !== undefined
        ? { isReminderOn }
        : {}),
      isOnlineMeeting,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Graph API ${response.status}: ${errorBody}`);
  }

  const created = CreatedEventSchema.parse(await response.json());
  return {
    subject: created.subject,
    start: created.start.dateTime,
    end: created.end.dateTime,
    attendees: created.attendees.map((a) => a.emailAddress.address),
    isReminderOn: created.isReminderOn,
    reminderMinutesBeforeStart: created.reminderMinutesBeforeStart,
    meetingUrl: created.onlineMeetingUrl,
  };
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const handlers: Record<string, ToolHandler> = {
  outlook_list_emails: outlookListEmails,
  outlook_read_email: outlookReadEmail,
  outlook_list_attachments: outlookListAttachments,
  outlook_download_attachment: outlookDownloadAttachment,
  outlook_send_email: outlookSendEmail,
  outlook_reply_to_latest_email: outlookReplyToLatestEmail,
  outlook_search_emails: outlookSearchEmails,
  outlook_list_calendar_events: outlookListCalendarEvents,
  outlook_create_calendar_event: outlookCreateCalendarEvent,
};

// Auto-register on import
for (const [name, handler] of Object.entries(handlers)) {
  registerHandler(name, handler);
}
