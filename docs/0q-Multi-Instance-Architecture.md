# HelkinSwarm Multi-Instance Architecture (One-to-One User-Aligned Deployments)
**Status:** Core requirement from RC2 onward

### Core Principle
Every user gets a **dedicated, isolated Azure footprint**. No shared resources except global service principals and the single Teams app. (however during development, its just understood the only existing instance will also be linked up to the development machinery of the main developer, so it will be used for development and testing, but it is still a one-to-one deployment, just with one user for now).

### Naming & Obfuscation Rules
- Resource Group: `rg-HelkinSwarm-[4-digit-alphanum]` (e.g. `rg-HelkinSwarm-a7f2`)
- All resources: suffix `-a7f2` (cosmos-HelkinSwarm-a7f2, func-HelkinSwarm-a7f2, etc.)
- User map stored in `config/user-map.json` (repo-level, gitignored or encrypted)

### Pipeline Integration
- New parameter in all workflows: `USER_ALIAS`
- Bicep dynamically builds names from alias
- Default for initial deployment: your UPN (eric@putersdcat.com) = alias `a7f2`

### Global Shared Components
- Entra App Registration + Service Principal: `HelkinSwarm-Core` (OAuth, GitHub integration)
- Teams app manifest: single global app
- Central router function (`HelkinSwarm-router`): routes incoming Teams activity by UPN → user-specific endpoint - this will need research with Microsoft Docs MCP to figure out the best practice approach for this, also cost efficient etc. 

### Deployment Flow
1. Commit to main
2. Pipeline reads `USER_ALIAS`
3. Stamps new RG + resources (or updates existing)
4. Legacy alpha RG remains untouched (mothballed)

### Future Expansion
- Add new user → add entry to user-map.json → run pipeline with new alias
- No code changes required

This construct is enforced from the first clean deployment onward.