

I'll scan the codebase systematically to document the Entra ID infrastructure, auth flows, and environmental constraints. Let me start by reading the relevant instruction files and exploring the key areas.
 

Read [](file:///c%3A/GitRoots/HelkinSwarm/src/auth)

Read [](file:///c%3A/GitRoots/HelkinSwarm/skills)

Read [](file:///c%3A/GitRoots/HelkinSwarm/.github/instructions/identity-auth.instructions.md)

Read [](file:///c%3A/GitRoots/HelkinSwarm/.github/instructions/bot-framework.instructions.md)

Read [](file:///c%3A/GitRoots/HelkinSwarm/.github/instructions/mcp-skills.instructions.md)

Read [](file:///c%3A/GitRoots/HelkinSwarm/skills/outlook)

Read [](file:///c%3A/GitRoots/HelkinSwarm/infra)

Read [](file:///c%3A/GitRoots/HelkinSwarm/src/auth/identity.ts)

Read [](file:///c%3A/GitRoots/HelkinSwarm/src/auth/oboTokenProvider.ts#1-1), lines 1 to 100

Read [](file:///c%3A/GitRoots/HelkinSwarm/src/auth/scopedTokenMinter.ts#1-1), lines 1 to 150

Searched for regex `/link|link outlook|linkGraph`, 30 results

Read [](file:///c%3A/GitRoots/HelkinSwarm/infra/main.bicep#1-1), lines 1 to 150

Read [](file:///c%3A/GitRoots/HelkinSwarm/skills/outlook/manifest.json#1-1), lines 1 to 100

Read [](file:///c%3A/GitRoots/HelkinSwarm/docs/11-Authentication-Identity.md)

Searched for regex `handleSlashCommand.*link|link.*command|slashCommand|/link`, 30 results

Read [](file:///c%3A/GitRoots/HelkinSwarm/infra/main.bicep#400-400), lines 400 to 600

Searched for regex `handleSlashCommand|linkCard|OAuthConnection|GraphOAuth` (`**/*.ts`), 7 results

Read [](file:///c%3A/GitRoots/HelkinSwarm/infra/main.bicep#600-600), lines 600 to 800

Read [](file:///c%3A/GitRoots/HelkinSwarm/src/bot)

Read [](file:///c%3A/GitRoots/HelkinSwarm/src/bot/HelkinSwarmBot.ts#1-1), lines 1 to 80

Read [](file:///c%3A/GitRoots/HelkinSwarm/src/bot/linkCards.ts)

Read [](file:///c%3A/GitRoots/HelkinSwarm/src/auth/graphTokenHelper.ts)

Searched for regex `/link.*outlook|linkOutlook|skillLink|getLinkableSkills` (`**/*.ts`), 8 results

Read [](file:///c%3A/GitRoots/HelkinSwarm/src/bot/HelkinSwarmBot.ts#200-200), lines 200 to 400

Read [](file:///c%3A/GitRoots/HelkinSwarm/src/bot/HelkinSwarmBot.ts#680-680), lines 680 to 820

Read [](file:///c%3A/GitRoots/HelkinSwarm/src/capabilities/capabilityLoader.ts#1-1), lines 1 to 80

Read [](file:///c%3A/GitRoots/HelkinSwarm/skills/outlook/manifest.json#1-1), lines 1 to 60

Read [](file:///c%3A/GitRoots/HelkinSwarm/appPackage/manifest.json#1-1), lines 1 to 80

I now have a comprehensive picture of the environment. Let me compile this into the technical brief you're asking for.

---

## HelkinSwarm — Entra ID Infrastructure & Outlook Delegation Environment

### 1. Entra App Registration Architecture

HelkinSwarm uses **two separate Entra App Registrations** with distinct purposes:

| App | AppId | Type | Purpose |
|-----|-------|------|---------|
| **HelkinSwarm Bot** (UAMI-based) | `42d3359f-8757-421d-a853-fb2960cf2dac` (manifest) / UAMI clientId (runtime) | User-Assigned MSI | Bot Framework identity, validates incoming Teams messages |
| **HelkinSwarm-DelegatedAuth** | `d4e5cf74-9f99-4504-b4ab-d4516dd10577` | Single-tenant with client secret | OAuth consent flow, OBO token exchange for delegated Graph access |

**Critical constraint**: The Bot identity uses `MICROSOFT_APP_TYPE=UserAssignedMsi` — **not** `SingleTenant`. This is set explicitly in main.bicep: `msaAppType: 'UserAssignedMSI'`.

---

### 2. Identity Model

The system implements a **zero-trust, on-demand credential model**:

| Identity Type | Lifetime | How Acquired |
|---------------|----------|--------------|
| **UAMI** (User-Assigned Managed Identity) | Permanent | Azure-provisioned; used by Function App for all Azure resource access |
| **Bot Framework Token** (OAuth tokens from `/link` flow) | Cached, long-lived via Bot Token Service + MSAL Cosmos plugin | User completes OAuth consent via sign-in card |
| **OBO Delegated Token** (oboTokenProvider.ts) | 5 minutes | Exchanged from Bot SSO token via DelegatedAuth app + client secret |
| **Scoped Token** (scopedTokenMinter.ts) | 5 minutes | App-level Graph tokens minted per capability manifest |

---

### 3. `/link outlook` OAuth Flow (Current Implementation)

```
User types "/link outlook"
        │
        ▼
handleLinkCommand()  [HelkinSwarmBot.ts:692]
        │
        ├── getUserToken(context, "GraphOAuth") ──► checks if token already cached
        │
        ├── If NO token:
        │       getSkillSignInLink(context, "GraphOAuth")
        │              │
        │              ▼
        │       buildSkillLinkSigninCard()  [linkCards.ts]
        │              │
        │              ▼
        │       SignInCard sent to user in Teams
        │              │
        │              ▼
        │       User clicks → Azure AD consent page
        │              │
        │              ▼
        │       handleTeamsSigninTokenExchange()  [HelkinSwarmBot.ts:731]
        │              │
        │              ▼
        │       Bot Framework Token Service caches token
        │       MSAL Cosmos plugin persists across container restarts
        │
        └── If token exists: "already linked" message
```

The OAuth connection `GraphOAuth` is defined in main.bicep and includes scopes:
```
User.Read Mail.ReadWrite Calendars.ReadWrite Files.ReadWrite offline_access
```

**Key files involved**:
- `src/bot/linkCards.ts` — SignIn card builder
- HelkinSwarmBot.ts — `handleLinkCommand()`
- `src/auth/graphTokenHelper.ts` — Token retrieval from Bot Token Service

---

### 4. Token Retrieval at Tool Time (Current Gap)

When an Outlook tool is invoked, token retrieval happens via graphTokenHelper.ts:

```typescript
// graphTokenHelper.ts:41
const connName = connectionName ?? env.botOAuthConnectionName;  // default: "GraphOAuth"
// ...
const result = await tokenClient.getUserToken(
  channelUserId, connName, channelId, ''
);
return result?.token;
```

This retrieves the **user's cached OAuth token** from the Bot Framework Token Service.

---

### 5. OBO Flow (For Acting AS the User)

`src/auth/oboTokenProvider.ts` handles on-behalf-of exchanges:

```
Bot SSO Token (from Teams)
        │
        ▼
acquireTokenOnBehalfOf({
  oboAssertion: <SSO token>,
  scopes: ["Mail.Read", "Calendars.Read", ...],
})
        │
        ▼
DelegatedAuth app (d4e5cf74-9f99-4504-b4ab-d4516dd10577)
  + client secret from Key Vault
        │
        ▼
Entra ID OBO endpoint
        │
        ▼
Short-lived Graph token (5 min) scoped to user
```

**Current implementation issue** (from CODEBASE-FLOW-ANALYSIS.md):
> "No OBO token flow in tool execution — `oboProvider.ts` exists and handles OAuth sign-in, but tool handlers receive the **app's scoped token** (UAMI), not the user's delegated token."

---

### 6. Infrastructure Constraints

**Multi-stamp architecture** (main.bicep):
- Each user stamp has its own UAMI, Key Vault, Cosmos DB, AI Foundry
- Global Router (`main-router.bicep`) optionally consolidates bot identity
- When `routerBotId` is set, stamps validate JWTs against the **router's UAMI** instead of their own

**Key Vault secret names** (all injected via UAMI at runtime):
- `DelegatedAuthClientSecret` — for OBO flow
- `OpenRouterApiKey` — BYOK LLM
- `GitHubAppId/PrivateKey/InstallationId` — SkillForge

**OAuth Connection deployment guard** (main.bicep):
```bicep
param createOAuthConnection bool = false  // ARM error 715-123420 on re-deploy
```
Must be `true` only on initial deploy or scope changes.

---

### 7. Current Outlook Skill Token Flow (As-Built)

Per `skills/outlook/handlers.ts`:
```typescript
// handlers.ts:27
throw new Error('No Graph token available. Please run /link first to connect your Microsoft account.');
```

The token used is the **Bot Token Service cached token** (from graphTokenHelper.ts), NOT the OBO flow. The scopedTokenMinter.ts provides a placeholder/fallback, and when an SSO assertion is available + graphScopes are defined, it calls `acquireTokenOnBehalfOf()` — but this path appears to be the **planned path, not the active one** per the codebase analysis.

---

### 8. What a Correct Outlook Email Delegation Solution Must Account For

1. **Two-token architecture**: Bot Framework OAuth token (cached, user-initiated consent) + optional OBO exchange for additional delegated scenarios
2. **Entra DelegatedAuth app** must have `User.Read Mail.ReadWrite Calendars.ReadWrite Files.ReadWrite offline_access` delegated permissions granted + admin consent
3. **OAuth connection** (`GraphOAuth`) in Bot Service must be created with `createOAuthConnection=true` on initial deploy
4. **Token persistence**: MSAL Cosmos plugin stores tokens in Cosmos DB `msalTokenCache` container (per-user partitioned)
5. **Zero secrets in code**: Client secret for DelegatedAuth app lives in Key Vault, retrieved via UAMI
6. **EU residency toggle**: `euResidencyMode` param affects AI model deployment SKU selection (DataZoneStandard vs GlobalStandard), not identity
7. **No LLM token exposure**: All token minting happens server-side in Durable Activities, tokens passed to executor, never to LLM sub-agent

---

### Summary for Your Expert Question

The Outlook `/link` flow is built on **Bot Framework OAuth** with the `GraphOAuth` connection pointing to the **HelkinSwarm-DelegatedAuth** Entra app (`d4e5cf74-...`). Tokens are cached in the Bot Token Service and persisted via MSAL Cosmos plugin. The **active token path** for Outlook tools reads from that Bot Token Service cache. The **OBO provider** (oboTokenProvider.ts) exists as infrastructure for 5-minute user-scoped token exchanges but the current Outlook tool handlers don't route through it — they use the cached OAuth token directly from graphTokenHelper.ts.

Any email delegation solution must work within: the two-app model (bot UAMI identity + DelegatedAuth app for OAuth), the 5-minute token TTL with MSAL persistence, the `UserAssignedMsi` app type requirement, and the requirement that all token operations happen server-side in Activities, never exposed to the LLM.



The task is complete. I've documented the full Entra ID infrastructure, OAuth flows, and environmental constraints for the Outlook `/link` delegation feature. The summary above captures the two-app registration model, the Bot Framework OAuth flow, token caching strategy, and all key architectural constraints you'll need to pass to the external expert.