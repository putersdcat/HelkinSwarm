**Here is the exact starter prompt** you can copy-paste to the Azure Agent (or DevLoop) right after Phase 0 is complete (repo + Bicep live and the delivery folder exists).

---

**Starter Prompt for Azure Agent:**

Please see the attached master plan: `docs/delivery/00-Development-&-Delivery-Master-Plan.md`

Your **first task** is to create the **complete, structured GitHub issue backlog** for the entire HelkinSwarm project.

Use the available GitHub MCP tooling when you can.

**Requirements:**

1. Read the full living specification:
   - All files in `Docs/` (01-Project-Overview.md through 16-Final-Notes-and-Bootstrap.md)
   - All 0a–0l addendums
   - The new 0m-Agentic-Tooling-Evaluation-Automation-and-Self-Tuning-Loop.md
   - The two delivery documents in `docs/delivery/` (01-Recurring-Maintenance-and-Introspection-Issues.md and 02-Agent-Definitions-and-Instruction-System.md)

2. Create a full set of GitHub issues and epics that map directly to every major capability and section in the specification.

For every issue/epic:
- Use clear, actionable titles
- Write detailed descriptions that reference the exact spec section(s)
- Include proper acceptance criteria
- Assign appropriate labels (`epic`, `mvp`, `infra`, `safety`, `devloop`, `skillforge`, `memory`, etc.)
- Assign to the correct milestone (v0.0, v0.1, v0.2, etc.)
- Link to the two permanent Never-Close issues from document 01 where relevant

3. Also create the two Never-Close issues (if they do not already exist) and pin them at the top of the repository.

4. After the backlog is fully created and organized, add a comment to this master plan issue (or create one if none exists) with:
   - Summary of how many issues/epics were created
   - A link to the main backlog view
   - Confirmation that the backlog is now complete and fully aligned with the current specification

Work systematically and create high-quality, actionable issues. Use the full context of the specification to make each one precise and traceable.

Begin now.

---

You can paste this directly once the repo is live and the master plan file is attached (or in the repo).

This prompt is self-contained, references everything we’ve built, and kicks off Phase 0.5 exactly as planned.

Let me know if you want any small tweaks before you use it!