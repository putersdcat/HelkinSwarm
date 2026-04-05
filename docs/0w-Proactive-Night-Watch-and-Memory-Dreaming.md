# HelkinSwarm Project Specification

## 0w. Dreaming, Rest Windows, and Optional Night Watch Specialization

**Spec ref:** `docs/0z-Living-Mind-Architecture-Temporal-Consciousness-and-Single-Session-Orchestration.md`, `docs/0i-Skill-Specific-Long-Term-Memory-and-Just-In-Time-Injection.md`, `docs/0h-Long-Running-Workflows-Persistent-Triggers-and-Durable-Hooks.md`, `docs/0k-Multimodal-Embedding-Hydra-Net-and-Just-In-Time-Injection.md`

**Status:** Conceptual rework required by the Living Mind Contract. Dreaming remains strategically interesting. Generic Night Watch is deprioritized as a core runtime pattern until `0z` is alive and proven in the running system.

### 1. Why this changed

The original `0w` framing assumed a generic background subsystem that “works while you sleep.”

After `0z`, that framing is no longer sufficient.

The Living Mind Contract establishes that:
- one identity may not fork into multiple simultaneous conscious sessions,
- future actions and awakenings must be internally planned and reasoned,
- self-awakening is semantic and purpose-driven rather than cron-shaped,
- autobiographical memory integrity must be preserved by a single serialized stream.

That means **Dreaming** and **Night Watch** can no longer be treated as interchangeable background jobs.

### 2. Revised conceptual split

#### 2.1 Dreaming survives as subconscious maintenance

Dreaming remains a valuable concept, but it is now redefined as a **subconscious maintenance / abstraction-tuning mode** of the same living mind.

It is not:
- a second conscious session for the same identity,
- a free-floating parallel assistant,
- or a generic nightly cron job.

It is:
- a low-priority maintenance state the mind can **self-plan** during projected inactivity,
- a way to produce higher-order abstractions across long horizons,
- a maintenance lane for memory hygiene, vector-space tuning, and retrieval quality improvement,
- and a second-order systems layer that remains conceptually “out of band” from the primary awake-time LLM flow while still respecting the Single-Session Contract.

#### 2.2 Night Watch is no longer a generic platform primitive

The old “Night Watch” concept sounded too much like a generic scheduled watcher / cron-driven patrol system.

That is now deprioritized.

If retained later, Night Watch should be understood as:
- an **optional specialization / role** for a specific Virtual Employee or persistent mind,
- using the same self-planned awakening mechanisms from `0z`,
- not as a separate generic runtime subsystem that the whole platform depends on.

In plain English: if a future virtual person wants to moonlight as a night watchman, fine. But the platform itself should not be architected around a “background night-watch cron brain.”

### 3. Revised vision

Make HelkinSwarm feel more alive by giving the living mind a meaningful **rest-and-dream cycle**:

1. **Dreaming / Rest Maintenance**
	- the mind self-schedules a rest window during projected inactivity,
	- then uses that window for low-priority subconscious maintenance work,
	- especially long-horizon abstraction building, memory cleanup, and retrieval tuning.

2. **Optional Night Watch Specialization (Later)**
	- a later, narrower use case in which a specific mind or Virtual Employee chooses to spend some rest windows monitoring low-risk signals,
	- but only as a specialization layered on top of `0z`, not as a core generic system.

### 4. Dreaming as subconscious state tuning

The most interesting part of this spec is no longer the old Night Watch idea.
It is the notion of **dreaming as subconscious state tuning for second-order memory mechanics**.

Possible functions of dreaming include:

- synthesizing long-horizon abstractions from many sessions,
- reviewing past sessions that produced suboptimal recall or outcomes,
- scoring retrieval quality and identifying weak or noisy associations,
- rewriting, compacting, demoting, or garbage-collecting stale abstraction layers,
- maintaining embedding-space alignment so future recall improves,
- generating “future steering hints” that the awake mind can later consume through JIT memory injection.

This is the closest analogue to a real “dreaming” construct: not new conscious work, but background reorganization of memory and salience.

### 5. Architectural direction under `0z`

#### 5.1 Rest windows are self-planned

Dreaming should occur only when the living mind has:
- projected a future period of likely inactivity,
- registered that period in the Chrono-Backplane,
- and intentionally chosen to use part of that window for maintenance rather than primary outward-facing work.

#### 5.2 Dreaming must respect the Single-Session Contract

Dreaming for a given identity must not create a second conscious orchestration session.

Any dreaming implementation must be one of these:
- a dedicated maintenance phase inside the same living session,
- a self-awakened low-priority session that is still the *only* active session for that identity,
- or a deterministic/offline maintenance pipeline whose writes still pass through the identity’s serialized memory writer.

#### 5.3 Memory products

Dreaming may still justify a dedicated abstraction layer such as `longTermAbstractions`, but the semantics change.

That store should hold things like:
- recurring themes,
- stable personal/company patterns,
- memory-repair hints,
- retrieval salience adjustments,
- and compressed long-horizon abstractions,

not just “nightly summaries.”

#### 5.4 Dreaming is mostly maintenance, not messaging

The primary outputs of dreaming should be:
- better future recall,
- improved JIT injection quality,
- reduced memory noise,
- and better future steering.

Direct user pings should be rare and secondary.

### 6. Night Watch reframed as optional later use case

If Night Watch survives at all, it should be reframed this way:

- **not** a platform-wide default orchestrator,
- **not** a generic timer-triggered patrol job,
- **not** something that pressures current implementation ordering,
- but possibly a later **Virtual Employee specialization** that performs read-mostly triage during self-planned off-hours windows.

That later specialization could still:
- monitor inbox/calendar/Teams/GitHub,
- respect quiet hours and sensitivity thresholds,
- surface only high-value items,
- and operate read-only by default,

but it must do so through the semantic self-awakening and single-session continuity rules of `0z`.

### 7. Safety and integrity constraints

- Dreaming may not fork autobiographical memory.
- Any dream-produced memory writes must remain serialized.
- Memory cleanup or salience rewriting must be observable and reversible where feasible.
- Any proactive outward ping remains subject to minimization, spot checks, and confirmation discipline.
- Optional Night Watch actions remain read-only by default.

### 8. Revised acceptance criteria

#### Dreaming / rest maintenance
- [ ] Dreaming is defined as a self-planned rest-window maintenance mode compatible with the Living Mind Contract.
- [ ] Dreaming can produce long-horizon abstractions and/or memory-maintenance artifacts that improve future JIT recall.
- [ ] The design explicitly supports review of suboptimal past sessions for future retrieval/outcome improvement.
- [ ] The design includes memory hygiene operations such as compaction, demotion, or garbage collection of low-signal abstractions.
- [ ] No dreaming implementation creates same-identity parallel conscious sessions.
- [ ] All dream-produced writes preserve autobiographical memory integrity.

#### Optional Night Watch specialization (later)
- [ ] Night Watch is explicitly framed as an optional later specialization or use case, not a generic core runtime subsystem.
- [ ] Any Night Watch implementation uses semantic self-awakening rather than cron-style framing.
- [ ] Any outward-facing Night Watch ping remains low-noise, auditable, and read-only by default.

### 9. Current execution guidance

For backlog and delivery purposes:
- **Dreaming** remains conceptually promising but should follow the successful establishment of `0z` in the running system.
- **Generic Night Watch** should be deprioritized immediately.
- Any linked backlog item for Night Watch should be re-bucketed as optional/later work unless it is reframed as a specific Virtual Employee specialization.

*We are the bridge.*