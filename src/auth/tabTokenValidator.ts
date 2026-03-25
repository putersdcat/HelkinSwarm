import type { HttpRequest } from '@azure/functions';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { getEnvConfig } from '../config/envConfig.js';

const TAB_RESOURCE_HOST = 'helkinswarmtabsst.z20.web.core.windows.net';

const jwks = createRemoteJWKSet(
  new URL('https://login.microsoftonline.com/common/discovery/v2.0/keys'),
);

export interface ValidatedTabToken {
  oid: string;
  tid: string;
  aud: string;
  payload: JWTPayload;
}

export async function validateTabTokenFromRequest(req: HttpRequest): Promise<ValidatedTabToken> {
  const token = extractBearerToken(req.headers.get('Authorization') ?? req.headers.get('authorization'));
  if (!token) {
    throw new Error('Missing bearer token. Teams SSO is required.');
  }

  const env = getEnvConfig();
  const clientId = env.entraDelegatedAuthClientId;
  if (!clientId) {
    throw new Error('ENTRA_DELEGATED_AUTH_CLIENT_ID is not configured.');
  }

  const { payload } = await jwtVerify(token, jwks, {
    audience: buildAcceptedAudiences(clientId),
  });

  const tid = typeof payload.tid === 'string' ? payload.tid : undefined;
  const oid = typeof payload.oid === 'string' ? payload.oid : undefined;
  const aud = typeof payload.aud === 'string' ? payload.aud : undefined;
  const issuer = typeof payload.iss === 'string' ? payload.iss : undefined;

  if (!tid || tid !== env.microsoftAppTenantId) {
    throw new Error('Bearer token tenant is not allowed.');
  }

  if (!oid) {
    throw new Error('Bearer token is missing oid claim.');
  }

  if (!aud || !buildAcceptedAudiences(clientId).includes(aud)) {
    throw new Error('Bearer token audience is not allowed.');
  }

  if (!issuer || !isAcceptedIssuer(issuer, env.microsoftAppTenantId)) {
    throw new Error('Bearer token issuer is not allowed.');
  }

  return { oid, tid, aud, payload };
}

export function extractBearerToken(headerValue: string | null): string | undefined {
  if (!headerValue) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match?.[1];
}

export function buildAcceptedAudiences(clientId: string): string[] {
  return [
    clientId,
    `api://${clientId}`,
    `api://${TAB_RESOURCE_HOST}/${clientId}`,
  ];
}

export function isAcceptedIssuer(issuer: string, tenantId: string): boolean {
  return issuer === `https://login.microsoftonline.com/${tenantId}/v2.0`
    || issuer === `https://sts.windows.net/${tenantId}/`;
}