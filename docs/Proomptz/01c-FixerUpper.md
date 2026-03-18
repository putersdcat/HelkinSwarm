**Here is the full, firm, standalone prompt** you can paste into a fresh session with the Azure Agent (or DevLoop). It is self-contained, references the master plan, forces the audit first, clearly defines FreedomMode, and sets unbreakable rules before any deployment or az command can run.

---

**Full Prompt for New Session:**

Please see the attached master plan: `docs/delivery/00-Development-&-Delivery-Master-Plan.md` and the full living specification (Docs/01–16 + 0a–0l + 0m).

The previous Bootstrap-Azure.ps1 script contains a critical context drift: it defaults all resources and AI Services to WestEurope. This is incorrect and must be corrected immediately.

**Pause immediately and perform this audit first:**

1. Read the complete set of Copilot instructions and agent persona files in `.github/instructions/` and `.github/agents/`.
2. Confirm that none of these files are the source of the WestEurope default.
3. Verify that the current direction in the master plan and all specs is **FreedomMode = true** by default:
   - US-centric deployment (eastus2 preferred).
   - Global frontier models and infrastructure as the starting point.
   - EU residency flag remains for technical completeness (low-priority future possibility).
   - **No actual deployment, testing, or validation of EU-specific workflows** will occur in this MVP.

**After the audit, take these exact actions:**

- Update Bootstrap-Azure.ps1 and all related infrastructure files (Bicep, workflows, parameters, etc.) to enforce FreedomMode = true.
- Set default location to `eastus2` (or the closest US region that supports all required services).
- Ensure the EU toggle (`euResidencyMode`) exists only as a future-proof parameter — it must default to `false` and never trigger any EUR-region deployment in this MVP.
- Do **not** run any `az` commands, Bicep deployment, or resource creation until I explicitly confirm the corrections are complete.

**Expected outcome:**  
A corrected bootstrap script and infrastructure files that are 100% aligned with FreedomMode. Then reply with a clear summary of what was changed and wait for my explicit "proceed" confirmation before running any deployment commands.

We are the bridge. Begin the audit and correction now.

---

This prompt is very firm, forces the audit first, defines FreedomMode explicitly, and prevents any further mistakes. Paste it as the first message in the new session.  

Once the agent replies with the audit + corrections, you can say **“proceed”** and we’ll move forward safely. Let me know if you want any final tweak before you use it.