// User Profile — manages user preferences and onboarding state in Cosmos DB.
// Stored in the `userProfiles` container, partitioned by userId, no TTL.
// Spec ref: 07-Memory-Manager.md, Issue #120

import { z } from 'zod';
import { getContainer } from './cosmosClient.js';

const CONTAINER_NAME = 'userProfiles';

export const CommunicationStyleSchema = z.enum([
  'concise',
  'detailed',
  'casual',
  'formal',
]);
export type CommunicationStyle = z.infer<typeof CommunicationStyleSchema>;

export const UserProfileSchema = z.object({
  id: z.string(),
  userId: z.string(),
  displayName: z.string().optional(),
  addressAs: z.string().optional(),
  communicationStyle: CommunicationStyleSchema.default('concise'),
  proactive: z.boolean().default(false),
  language: z.string().default('en'),
  timezone: z.string().optional(),
  onboardedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

/**
 * Load user profile from Cosmos.
 * Returns undefined if no profile exists (first-time user).
 */
export async function getUserProfile(userId: string): Promise<UserProfile | undefined> {
  const container = getContainer(CONTAINER_NAME);
  try {
    const { resource } = await container.item(userId, userId).read<UserProfile>();
    if (!resource) return undefined;
    return UserProfileSchema.parse(resource);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 404) {
      return undefined;
    }
    throw err;
  }
}

/**
 * Save or update a user profile.
 */
export async function saveUserProfile(profile: UserProfile): Promise<void> {
  const validated = UserProfileSchema.parse(profile);
  const container = getContainer(CONTAINER_NAME);
  await container.items.upsert({
    ...validated,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Create default profile for a user (sensible defaults if they skip onboarding).
 */
export function createDefaultProfile(userId: string): UserProfile {
  return UserProfileSchema.parse({
    id: userId,
    userId,
    communicationStyle: 'concise',
    proactive: false,
    language: 'en',
  });
}

/**
 * Build a human-readable summary of user preferences for injection into the system prompt.
 */
export function profileToPromptFragment(profile: UserProfile): string {
  const parts: string[] = [];

  if (profile.addressAs) {
    parts.push(`Address the user as "${profile.addressAs}".`);
  }

  const styleMap: Record<CommunicationStyle, string> = {
    concise: 'Be concise and technical. Short answers, code-first.',
    detailed: 'Be detailed and explanatory. Include context and rationale.',
    casual: 'Be casual and friendly. Use conversational tone.',
    formal: 'Be formal and professional. Use precise, structured language.',
  };
  parts.push(styleMap[profile.communicationStyle]);

  if (profile.proactive) {
    parts.push('Proactively offer suggestions, improvements, and related information without being asked.');
  } else {
    parts.push('Only respond to what is asked. Do not volunteer unsolicited suggestions.');
  }

  if (profile.language && profile.language !== 'en') {
    parts.push(`Respond primarily in: ${profile.language}.`);
  }

  if (profile.timezone) {
    parts.push(`User timezone: ${profile.timezone}.`);
  }

  return parts.join(' ');
}
