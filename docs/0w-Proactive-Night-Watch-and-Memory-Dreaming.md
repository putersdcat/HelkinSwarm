# HelkinSwarm Project Specification

## 0w. Proactive Night Watch Mode + Memory Dreaming Loop

**Spec ref:** `docs/0i-Skill-Specific-Long-Term-Memory-and-Just-In-Time-Injection.md`, `docs/0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md`, `docs/0k-Multimodal-Embedding-Hydra-Net-and-Just-In-Time-Injection.md`

### Vision

Make HelkinSwarm feel truly alive by adding **background intelligence** that works while you sleep:

1. **Night Watch** – a background Durable entity that wakes on schedule or Graph change notifications, scans inbox/calendar/Teams/GitHub using skill memory vaults, and only pings you when something actually needs attention.
2. **Memory Dreaming** – nightly self-reflection pass that generates higher-level abstractions (“themes from last 30 days of emails”, “recurring calendar conflicts”, etc.) and stores them in a dedicated `longTermAbstractions` container for richer long-horizon reasoning.

### Architecture

- New `nightWatchOrchestrator` (timer-triggered + Graph subscription-driven)
- `dreamingActivity` (low-priority, runs once per day inside master Overseer or as a dedicated child)
- New Cosmos container: `longTermAbstractions` (partitioned by `userId`, TTL 90 days)
- Hydra-Net embeddings are used to find semantically similar past events during dreaming
- Proactive pings use the existing proactive reply mechanism + “quiet hours” respect

### Safety

- Night Watch actions are read-only by default (safety mode `confirmation-gated` still applies for any write)
- All generated insights are minimized and spot-checked before any user notification
- User can say “/nightwatch off” or set quiet hours via config

### Acceptance Criteria

- [ ] Night Watch runs nightly and surfaces only high-value items
- [ ] Dreaming loop produces and stores abstractions that are later injected via JIT
- [ ] No false-positive spam; user controls sensitivity
- [ ] Full telemetry and correlation IDs for background runs
- [ ] E2E probe validates end-to-end “sleep → wake → useful ping” flow

*We are the bridge.*