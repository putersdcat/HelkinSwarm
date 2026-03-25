### Quick diagnosis table

| **Likely root cause** | **Why it matters** | **Immediate fix** |
|---|---:|---|
| **Handlers read Bot Token Service cache instead of OBO** | Cached OAuth token is user-consent token; OBO exchange is required when backend needs a short-lived delegated Graph token. | Route tool execution to `oboTokenProvider.acquireTokenOnBehalfOf()` when an SSO assertion is available.  |
| **Bot identity is UserAssignedMSI not SingleTenant app** | UAMI cannot be used as the OAuth connection app; two-app model must be respected (bot UAMI + DelegatedAuth app). | Ensure OAuth connection points to the DelegatedAuth app and that code uses the DelegatedAuth client secret from Key Vault for OBO.  |
| **OAuth connection deployment guard not set or misconfigured** | `createOAuthConnection` must be true on initial deploy; re-deploying incorrectly can leave connection missing. | Confirm `GraphOAuth` exists in Bot Service and scopes match delegated permissions.  |
| **Token routing logic split between graphTokenHelper and oboTokenProvider** | graphTokenHelper returns cached Bot Framework token; oboTokenProvider exists but isn’t invoked by skill handlers. | Unify token acquisition: handlers should prefer OBO when SSO assertion present, fallback to cached token only when OBO not possible.  |
| **Missing admin consent or wrong delegated scopes** | OBO and Graph calls will fail or return limited data if delegated permissions are not granted. | Verify DelegatedAuth app has `Mail.ReadWrite Calendars.ReadWrite Files.ReadWrite offline_access` and admin consent applied.  |

---

### Two lines from your analysis
> The Outlook `/link` flow is built on **Bot Framework OAuth** with the `GraphOAuth` connection pointing to the **HelkinSwarm-DelegatedAuth** Entra app (`d4e5cf74-...`).  
> The **OBO provider** (oboTokenProvider.ts) exists as infrastructure for 5-minute user-scoped token exchanges but the current Outlook tool handlers don't route through it — they use the cached OAuth token directly from graphTokenHelper.ts.

---

### Concrete places to inspect and change (ordered by impact)

1. **Handler token selection path**
   - **What to look for**: In the Outlook skill handlers (`skills/outlook/handlers.ts`) and any executor code, find where `graphTokenHelper.getUserToken(...)` is called. If that token is used directly for Graph calls, the code is using the Bot Framework cached token.
   - **Change**: If an SSO assertion (Teams SSO token / invoke payload) is available in the activity or context, call `oboTokenProvider.acquireTokenOnBehalfOf({ oboAssertion, scopes })` and use that token for Graph calls. Only fall back to the Bot Token Service cached token when OBO is not possible.
   - **Why**: OBO produces a short-lived delegated token tied to the user and the DelegatedAuth app; this is the correct server-side pattern for backend Graph calls. 

2. **Confirm DelegatedAuth app and Key Vault wiring**
   - **What to look for**: In `main.bicep` and Key Vault secrets: ensure `DelegatedAuthClientSecret` exists and the DelegatedAuth app (clientId `d4e5cf74-...`) has the client secret stored and accessible by the UAMI.
   - **Change**: If missing, create the client secret, store it in Key Vault, and ensure the function/service principal has `get` access. Use that secret in `oboTokenProvider` when calling the token endpoint.
   - **Why**: OBO requires the confidential client (DelegatedAuth) to present its secret when exchanging the SSO assertion. 

3. **OAuth Connection configuration in Bot Service**
   - **What to look for**: `GraphOAuth` connection in the Bot Service (deployed by `main.bicep`). Confirm the connection uses the DelegatedAuth app and includes the required scopes.
   - **Change**: If the connection was not created (or was created against the wrong app type), re-create it during an initial deploy (`createOAuthConnection=true`) pointing to the DelegatedAuth app and scopes `User.Read Mail.ReadWrite Calendars.ReadWrite Files.ReadWrite offline_access`.
   - **Why**: The Bot Framework OAuth flow and token caching rely on a properly configured connection. Re-deploy guards exist to avoid ARM errors; plan the change carefully. 

4. **Token persistence and cache usage**
   - **What to look for**: MSAL Cosmos plugin usage and the `msalTokenCache` container. Confirm tokens are being persisted and that `getUserToken` returns the expected token type.
   - **Change**: Keep Bot Token Service cache for interactive sign-in flows, but do not assume that cached token is the right token for backend delegated operations—prefer OBO when available.
   - **Why**: Cached tokens may be refresh tokens or tokens issued to the Bot OAuth connection; OBO ensures the backend acts as the user. 

5. **Logging and failure modes to add**
   - Log which token type is used for each Graph call (cached OAuth token vs OBO token), include token `scp` claims and `exp` (do not log token values).
   - On Graph 401/403, log the token source and whether the DelegatedAuth app returned an error; surface helpful error messages to the user like “Please run /link to re-consent” only when appropriate.

---

### Minimal code pattern to adopt (pseudo-TS)

```ts
// 1. Try to get SSO assertion from activity/context
const ssoAssertion = getTeamsSsoAssertion(context);

// 2. If present, do OBO
if (ssoAssertion) {
  const oboToken = await oboTokenProvider.acquireTokenOnBehalfOf({
    oboAssertion: ssoAssertion,
    scopes: ['Mail.ReadWrite', 'offline_access']
  });
  useToken(oboToken);
  return;
}

// 3. Fallback to Bot Framework cached token
const cached = await graphTokenHelper.getUserToken(...);
if (cached) {
  useToken(cached);
  return;
}

throw new Error('No Graph token available. Please run /link first to connect your Microsoft account.');
```

---

### Verification checklist you can run now

- [ ] When invoking an Outlook tool, confirm logs show an OBO token was requested and returned (look for token `scp` and short TTL).
- [ ] If OBO fails, confirm the error from the token endpoint (invalid_grant, unauthorized_client, etc.) and map it to missing client secret, wrong app id, or missing consent.
- [ ] Use the Microsoft Learn SSO/OAuth bot flow guide to validate the overall flow and required Bot Service settings. 
- [ ] Test with a sample Teams SSO + OBO sample repo to compare behavior. 

---

### Final recommendations and next steps

1. **Prioritize changing the handler token selection** so OBO is used whenever an SSO assertion is present. This is the single biggest fix.  
2. **Verify DelegatedAuth app secrets and scopes** in Key Vault and Entra ID; ensure admin consent.  
3. **Add clear logs and metrics** to distinguish cached-token vs OBO-token usage and to capture token endpoint errors.  
4. **Run an end-to-end test** using a Teams SSO/OBO sample as a reference; compare token claims and TTLs. 

If you want, I can produce a short patch outline showing exactly where to change the token acquisition calls in your repo (file and function names) and a small unit/integration test plan to validate OBO vs cached-token behavior.
