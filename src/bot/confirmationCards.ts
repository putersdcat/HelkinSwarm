// Confirmation cards — Adaptive Cards for human approval of medium/high-risk actions.
// Spec ref: 10-Teams-Interface.md, 0e-Safety-and-Four-Eyes-Verification-Pipeline.md

import { CardFactory, type Attachment } from 'botbuilder';

export interface ConfirmationCardData {
  correlationId: string;
  userId: string;
  toolName: string;
  risk: 'medium' | 'high';
  description: string;
  sessionInstanceId: string;
  timeoutSeconds?: number;
}

/**
 * Build an Adaptive Card for human confirmation of a tool execution.
 * Approve/Cancel buttons submit actionInvoke back to the bot.
 */
export function buildConfirmationCard(data: ConfirmationCardData): Attachment {
  const timeout = data.timeoutSeconds ?? 300;
  const riskBadge = data.risk === 'high' ? '🔴 HIGH RISK' : '🟡 MEDIUM RISK';

  const card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: `${riskBadge} — Action Requires Approval`,
        weight: 'Bolder',
        size: 'Medium',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: `**Tool:** ${data.toolName}`,
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: data.description,
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: `Auto-cancels in ${Math.floor(timeout / 60)} minutes if no response.`,
        isSubtle: true,
        size: 'Small',
        wrap: true,
      },
    ],
    actions: [
      {
        type: 'Action.Execute',
        title: '✅ Approve',
        verb: 'confirm_action',
        data: {
          action: 'approved',
          correlationId: data.correlationId,
          userId: data.userId,
          toolName: data.toolName,
          sessionInstanceId: data.sessionInstanceId,
        },
      },
      {
        type: 'Action.Execute',
        title: '❌ Cancel',
        verb: 'confirm_action',
        data: {
          action: 'denied',
          correlationId: data.correlationId,
          userId: data.userId,
          toolName: data.toolName,
          sessionInstanceId: data.sessionInstanceId,
        },
      },
    ],
  };

  return CardFactory.adaptiveCard(card);
}

// ---------------------------------------------------------------------------
// Tentative Action Confirmation Card
// ---------------------------------------------------------------------------

export interface TentativeActionCardData {
  actionId: string;
  correlationId: string;
  userId: string;
  actionType: string;
  summary: string;
  hookId: string;
  timeoutMinutes?: number;
}

/**
 * Build an Adaptive Card for confirming/denying a tentative action.
 * Used when a durable hook fires and creates pending actions (calendar, booking, etc).
 */
export function buildTentativeActionCard(data: TentativeActionCardData): Attachment {
  const timeout = data.timeoutMinutes ?? 60;

  const typeLabel: Record<string, string> = {
    calendar_create: '📅 Calendar Event',
    calendar_update: '📅 Calendar Update',
    email_reply: '✉️ Email Reply',
    booking_confirm: '🎫 Booking',
    payment_authorize: '💳 Payment',
    custom: '⚙️ Action',
  };

  const card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: `${typeLabel[data.actionType] ?? '⚙️ Action'} — Confirm or Cancel`,
        weight: 'Bolder',
        size: 'Medium',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: data.summary,
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: `Auto-cancels in ${timeout} minutes if no response.`,
        isSubtle: true,
        size: 'Small',
        wrap: true,
      },
    ],
    actions: [
      {
        type: 'Action.Execute',
        title: '✅ Confirm',
        verb: 'tentative_action',
        data: {
          action: 'approved',
          actionId: data.actionId,
          correlationId: data.correlationId,
          userId: data.userId,
          hookId: data.hookId,
        },
      },
      {
        type: 'Action.Execute',
        title: '❌ Cancel',
        verb: 'tentative_action',
        data: {
          action: 'denied',
          actionId: data.actionId,
          correlationId: data.correlationId,
          userId: data.userId,
          hookId: data.hookId,
        },
      },
    ],
  };

  return CardFactory.adaptiveCard(card);
}

// ---------------------------------------------------------------------------
// Persona Reload Confirmation Card (#487 AC3)
// ---------------------------------------------------------------------------

export interface PersonaReloadCardData {
  userId: string;
  /** First N chars of current persona for preview */
  currentPreview: string;
  /** First N chars of new persona for preview */
  newPreview: string;
}

/**
 * Build an Adaptive Card confirming a persona hot-reload.
 * Shows a preview of the change so the operator can verify before activating.
 */
export function buildPersonaReloadCard(data: PersonaReloadCardData): Attachment {
  const card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: '♻️ Persona Reload — Confirm Change',
        weight: 'Bolder',
        size: 'Medium',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: '**Current persona (first 200 chars):**',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: data.currentPreview || '_(not loaded yet — first prompt will load)_',
        wrap: true,
        isSubtle: true,
        maxLines: 4,
      },
      {
        type: 'TextBlock',
        text: '**New persona from disk (first 200 chars):**',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: data.newPreview || '_(empty or unreadable)_',
        wrap: true,
        isSubtle: true,
        maxLines: 4,
      },
    ],
    actions: [
      {
        type: 'Action.Execute',
        title: '✅ Activate New Persona',
        verb: 'confirm_persona_reload',
        data: {
          action: 'approved',
          userId: data.userId,
        },
      },
      {
        type: 'Action.Execute',
        title: '❌ Keep Current',
        verb: 'confirm_persona_reload',
        data: {
          action: 'denied',
          userId: data.userId,
        },
      },
    ],
  };

  return CardFactory.adaptiveCard(card);
}
