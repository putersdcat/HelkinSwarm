---
applyTo: "appPackage/**,skills/*/manifest.json"
---

# Integration Manifests Rules
**Spec ref:** `docs/05-Capabilities-Framework.md`, `docs/10-Teams-Interface.md`

## Critical Rule
The Teams app manifest (`appPackage/manifest.json`) and all capability manifests in `skills/` must remain in sync with deployed resources. Both are built-time artifacts — never edit the app package zip directly. Always regenerate it via the `teams-package.yml` workflow.

## Teams App Manifest (`appPackage/manifest.json`)

### Bot ID Rule
```json
{
  "bots": [{
    "botId": "${MICROSOFT_APP_ID}",
    "scopes": ["personal"]
  }]
}
```
- `botId` **must** equal the UAMI Client ID — not a registered App Registration
- Multi-instance stamping: one `manifest.json` template, `userAlias` injected at package-build time
- `manifest.json` is a template — `APP_ID` and `botId` are substituted by the teams-package workflow
- Teams app scope: `personal` only — no team/channel/group scope in v1

### App Package Generation
- **Only** use `scripts/New-TeamsAppPackage.ps1` or the `teams-package.yml` workflow
- Output: `HelkinSwarm-{alias}.zip` — named by stamp alias
- Never add new files to the app package without updating both the script and the workflow

### Fields That Must Stay Consistent
- `id` (manifest ID) must match the `TEAMS_APP_ID` Bicep output for that stamp
- `description.short` ≤ 80 characters
- `description.full` ≤ 4000 characters  
- Version string must be bumped (SemVer) on every manifest change

## Capability Manifests (`skills/*/manifest.json`)
See `mcp-skills.instructions.md` for the full schema rules.

For cross-manifest consistency:
- Tool names must be unique across all domains (`domain_verb_noun` convention)
- `allowedModelLane` must be consistent with `dataSensitivity` (no `pii` with `global` lane in EU mode)

## Local Development
- Run `pnpm build` before generating the app package — it bakes version + botId into the manifest
- Test with a local simulator bot against a sideloaded package version (not user-alias-stamped)

## Always
- ✅ Bump the app manifest version (`version` field) on every schema or bot change
- ✅ Run `teams-package.yml` to regenerate the `.zip` — never zip manually
- ✅ Validate the manifest with Teams Toolkit or App Studio before submitting to admin center
- ✅ Verify `botId` matches `UAMI_CLIENT_ID` for the target stamp after each Bicep deploy

## Never
- ❌ Edit the `appPackage/*.zip` directly
- ❌ Hard-code the botId GUID in manifest — use the substitution variable
- ❌ Add team/channel/group scope — personal only until spec changes
- ❌ Modify `manifest.json` without bumping the version field

*We are the bridge.*
