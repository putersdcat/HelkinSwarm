// Outlook + Calendar skill handlers — Graph API operations on behalf of the user.
// Spec ref: 05-Capabilities-Framework.md, 06-Tool-Dispatch-LLM-Layer.md
// Issue: #117
//
// Auth: OBO delegated tokens via Bot Framework OAuth connection (GraphOAuth).
// The user must run /link first to cache a Graph token in the Bot Token Service.

import type { ToolHandler } from '../../src/capabilities/capabilityLoader.js';
import { z } from 'zod';
import { getGraphTokenForUser } from '../../src/auth/graphTokenHelper.js';
import { registerHandler } from '../../src/capabilities/capabilityLoader.js';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

async function graphFetch<T>(
  userId: string,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const token = await getGraphTokenForUser(userId);
  if (!token) {
    throw new Error('No Graph token available. Please run /link first to connect your Microsoft account.');
  }

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

const SearchResultSchema = z.object({
  value: z.array(z.object({
    hitsContainers: z.array(z.object({
      hits: z.array(z.object({
        resource: MessageSchema,
      })).default([]),
    })).default([]),
  })).default([]),
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

const outlookListEmails: ToolHandler = async (args) => {
  const userId = z.string().parse(args['userId']);
  const top = Math.min(z.number().default(10).parse(args['top'] ?? 10), 50);
  const folder = z.string().default('inbox').parse(args['folder'] ?? 'inbox');
  const filter = args['filter'] as string | undefined;

  const folderPath = FOLDER_MAP[folder.toLowerCase()] ?? 'inbox';
  let path = `/me/mailFolders/${folderPath}/messages?$top=${top}&$select=id,subject,bodyPreview,from,receivedDateTime,isRead,hasAttachments&$orderby=receivedDateTime desc`;

  if (filter) {
    path += `&$filter=${encodeURIComponent(filter)}`;
  }

  const result = await graphFetch(userId, path, MessageListSchema);

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
  const userId = z.string().parse(args['userId']);
  const messageId = z.string().parse(args['messageId']);

  const result = await graphFetch(
    userId,
    `/me/messages/${encodeURIComponent(messageId)}?$select=id,subject,body,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments`,
    MessageSchema,
  );

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
  };
};

const outlookSendEmail: ToolHandler = async (args) => {
  const userId = z.string().parse(args['userId']);
  const to = z.array(z.string()).parse(args['to']);
  const subject = z.string().parse(args['subject']);
  const body = z.string().parse(args['body']);
  const bodyType = z.string().default('text').parse(args['bodyType'] ?? 'text');
  const cc = z.array(z.string()).default([]).parse(args['cc'] ?? []);

  const token = await getGraphTokenForUser(userId);
  if (!token) throw new Error('No Graph token. Run /link first.');

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
    throw new Error(`Graph API ${response.status}: ${errorBody}`);
  }

  return { success: true, message: `Email sent to ${to.join(', ')}` };
};

const outlookSearchEmails: ToolHandler = async (args) => {
  const userId = z.string().parse(args['userId']);
  const query = z.string().parse(args['query']);
  const top = Math.min(z.number().default(10).parse(args['top'] ?? 10), 25);

  const token = await getGraphTokenForUser(userId);
  if (!token) throw new Error('No Graph token. Run /link first.');

  const response = await fetch(`${GRAPH_BASE}/search/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [{
        entityTypes: ['message'],
        query: { queryString: query },
        size: top,
      }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Graph API ${response.status}: ${errorBody}`);
  }

  const data = SearchResultSchema.parse(await response.json());
  const hits = data.value[0]?.hitsContainers[0]?.hits ?? [];

  return hits.map((h) => ({
    id: h.resource.id,
    subject: h.resource.subject,
    from: h.resource.from?.emailAddress?.address,
    receivedAt: h.resource.receivedDateTime,
    preview: h.resource.bodyPreview?.slice(0, 200),
  }));
};

const outlookListCalendarEvents: ToolHandler = async (args) => {
  const userId = z.string().parse(args['userId']);
  const top = z.number().default(10).parse(args['top'] ?? 10);
  const now = new Date();
  const startDateTime = z.string().default(now.toISOString()).parse(args['startDateTime'] ?? now.toISOString());
  const endDateTime = z.string().default(
    new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  ).parse(args['endDateTime'] ?? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString());

  const path = `/me/calendarView?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(endDateTime)}&$top=${top}&$select=id,subject,organizer,start,end,location,attendees,isOnlineMeeting,onlineMeetingUrl,bodyPreview&$orderby=start/dateTime`;

  const result = await graphFetch(userId, path, CalendarEventListSchema);

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
  const userId = z.string().parse(args['userId']);
  const subject = z.string().parse(args['subject']);
  const start = z.string().parse(args['start']);
  const end = z.string().parse(args['end']);
  const location = args['location'] as string | undefined;
  const body = args['body'] as string | undefined;
  const attendees = z.array(z.string()).default([]).parse(args['attendees'] ?? []);
  const isOnlineMeeting = z.boolean().default(false).parse(args['isOnlineMeeting'] ?? false);

  const token = await getGraphTokenForUser(userId);
  if (!token) throw new Error('No Graph token. Run /link first.');

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
      isOnlineMeeting,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Graph API ${response.status}: ${errorBody}`);
  }

  const created = CreatedEventSchema.parse(await response.json());
  return {
    id: created.id,
    subject: created.subject,
    start: created.start.dateTime,
    end: created.end.dateTime,
    attendees: created.attendees.map((a) => a.emailAddress.address),
    meetingUrl: created.onlineMeetingUrl,
  };
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const handlers: Record<string, ToolHandler> = {
  outlook_list_emails: outlookListEmails,
  outlook_read_email: outlookReadEmail,
  outlook_send_email: outlookSendEmail,
  outlook_search_emails: outlookSearchEmails,
  outlook_list_calendar_events: outlookListCalendarEvents,
  outlook_create_calendar_event: outlookCreateCalendarEvent,
};

// Auto-register on import
for (const [name, handler] of Object.entries(handlers)) {
  registerHandler(name, handler);
}
