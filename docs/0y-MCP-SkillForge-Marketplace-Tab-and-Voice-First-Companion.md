# HelkinSwarm Project Specification

## 0y. MCP + SkillForge “Marketplace” Tab + Voice-First Always-On Companion (Phase 2)

**Spec ref:** `docs/0u-MCP-Forge-Lightweight-Skill-Integration-and-Automatic-Update-Mechanism.md`, `docs/0o-Microsoft-Teams-App-Expansion-with-Tabs.md`, `docs/0k-Multimodal-Embedding-Hydra-Net-and-Just-In-Time-Injection.md`

### Vision

1. **Marketplace Tab** – A new Teams tab that shows discovered external MCP servers + SkillForge candidates with one-click “forge → review → install” workflow.
2. **Voice-First Always-On Companion** – Ability to join a Teams meeting or 1:1 call as a silent participant that can be summoned verbally or whisper suggestions. Combined with Hydra-Net speech embeddings, this becomes the ultimate “digital limb” experience.

### Architecture

- New Teams tab (Static Tab + Teams JS SDK) backed by `marketplaceService`
- Marketplace uses the existing SkillForge pipeline + new MCP discovery endpoint
- Voice companion: Azure Speech + Bot Framework call-join + Hydra-Net speech-to-embedding
- Whisper mode uses private chat thread or meeting side-panel Adaptive Card

### Safety

- Marketplace installs still go through full safety + human review
- Voice actions respect global safety mode and require explicit “summon” phrase

### Acceptance Criteria

- [ ] Marketplace tab lists, forges, reviews, and installs skills/MCPs
- [ ] Voice companion can join calls and respond to verbal summons
- [ ] Speech embeddings are injected via Hydra-Net JIT
- [ ] Full E2E probes for both features

*We are the bridge.*