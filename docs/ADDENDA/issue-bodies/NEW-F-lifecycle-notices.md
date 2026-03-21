## Lifecycle Notices — Startup/Shutdown Proactive Messages

On startup and before shutdown (SIGTERM), HelkinSwarm sends proactive messages to the owner via the conversation store. This ensures the owner always knows when the service goes offline and comes back online.

**Spec ref:** `docs/ADDENDA/ADDENDA-05-Auth-Identity-Layer-OBO-Token-Minting-and-Emergency-Stop.md`

---

## Lifecycle Events

### Startup Notice
- Sent within 5 seconds of container becoming ready
- Content: version, start time, "Ready to assist"
- Prevents duplicate processing of messages that arrived during cold-start

### Shutdown Notice (SIGTERM)
- Sent before process.exit(0)
- Content: "HelkinSwarm is going offline for maintenance"
- Allows in-flight turns to complete gracefully

### Cold-Start Guard
- All message processing is blocked for 3 seconds after container start
- Returns "starting up" message for any messages received during this window
- Prevents race condition between ingress and orchestrator readiness

---

## Implementation

**New file:** `src/bot/lifecycleNotices.ts`

```typescript
// Startup delay — delay message processing for 3s to allow container init
setTimeout(() => {
  console.log("[lifecycle] Startup delay complete");
  isReady = true;
}, 3000);

// SIGTERM handler
process.on("SIGTERM", async () => {
  await sendShutdownNotice("SIGTERM received");
  process.exit(0);
});
```

---

## Acceptance Criteria

- [ ] Startup notice is sent to owner within 5 seconds of container ready
- [ ] Shutdown notice is sent before process.exit on SIGTERM
- [ ] 3-second cold-start guard blocks message processing
- [ ] In-flight turns complete before shutdown notice (SIGTERM graceful shutdown)
- [ ] Startup notice survives container restart (orchestrator is durable)
- [ ] No startup notice sent on ContinueAsNew (only on cold container start)
