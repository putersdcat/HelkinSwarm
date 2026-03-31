import { createHash } from 'node:crypto';

export interface OverseerDedupIdentityInput {
  userId: string;
  userMessage: string;
  modelOverride?: string;
  skillForgeRequest?: { idea: string };
  messageId?: string;
  timeBucket?: number;
}

export interface OverseerDedupIdentity {
  timeBucket: number;
  instanceId: string;
  previousInstanceId: string;
}

/**
 * Build the current + previous minute overseer instance ids used for durable dedup.
 *
 * Prefer the exact Teams activity id when available so legitimate repeated short
 * messages such as `cancel` do not collide purely on text within the 60s dedup window.
 */
export function buildOverseerDedupIdentity(
  input: OverseerDedupIdentityInput,
): OverseerDedupIdentity {
  const timeBucket = input.timeBucket ?? Math.floor(Date.now() / 60_000);
  const routingDiscriminator = [
    `model:${input.modelOverride ?? 'default'}`,
    `skillforge:${input.skillForgeRequest ? 'on' : 'off'}`,
    `message:${input.messageId ?? 'none'}`,
  ].join('|');
  const dedupBasis = input.messageId ?? input.userMessage.slice(0, 200);

  const makeDedupHash = (bucket: number): string =>
    createHash('sha256')
      .update(`${input.userId}:${bucket}:${routingDiscriminator}:${dedupBasis}`)
      .digest('hex')
      .slice(0, 12);

  return {
    timeBucket,
    instanceId: `overseer-${input.userId}-${makeDedupHash(timeBucket)}`,
    previousInstanceId: `overseer-${input.userId}-${makeDedupHash(timeBucket - 1)}`,
  };
}