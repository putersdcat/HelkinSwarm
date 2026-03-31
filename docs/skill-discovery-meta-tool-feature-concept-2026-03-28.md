# Skill Discovery Meta-Tool Feature Concept — 2026-03-28

## Status of this document

This document is the **historical design reference** for the manifest-driven skill discovery / `helkin_skill_search` concept.

It is **not** the canonical source of truth for the current implementation. Repo-grounded implementation behavior is documented in:

- `docs/05-Capabilities-Framework.md`
- `src/capabilities/skillDiscoveryIndex.ts`
- `src/orchestrator/discoveryToolInjection.ts`
- `skills/core/manifest.json`
- `skills/core/handlers.ts`

Related backlog stack:

- `#332` — manifest-driven skill discovery layer for orchestrator-scale tool routing
- `#333` — extend skill manifest schema with discovery metadata for skill/tool search
- `#335` — implement core `helkin_skill_search` discovery tool
- `#336` — add discovery-first second-hop tool injection to orchestration flow
- `#337` — add telemetry and validation for discovery-first tool routing
- `#338` — backport instructions, manifest updates, and repo docs for discovery-layer delivery

## Original problem statement

As HelkinSwarm accumulates more skills and broader tool surfaces, injecting the full available tool universe into the top-level orchestrator every turn would eventually cause:

- context-window blowout
- tool-selection blindness
- subtle mismatches between similar tools
- degraded reasoning quality at the orchestration layer

The design answer was to make the top layer discovery-first rather than omniscient.

## Core concept

### 1. A meta-tool for capability discovery

Introduce a core discovery tool that lets the top-level orchestrator search the installed skill/tool universe in a controlled, token-efficient way rather than seeing every possible tool up front.

The conceptual UX was intentionally CLI-like:

- `skillSearch help`
- `skillSearch <search terms>`
- `skillSearch <skill_name> help`

The eventual implementation translated that idea into a schema-driven tool contract via `helkin_skill_search` while preserving the same mental model:

- `help`
- `search`
- `describe_skill`
- `describe_tool`
- `list_domains`

### 2. Manifest-driven search instead of hand-maintained catalogs

The feature was always intended to compile its discovery dataset from the existing skill manifests rather than from a parallel manually curated registry.

That implies discovery metadata belongs in manifests, not in hard-coded prompt text.

### 3. Two-hop orchestration

The orchestrator should:

1. begin with a very small core tool surface
2. use the discovery tool when broader skill selection is needed
3. inject only the matched skill/tool subset into the next reasoning hop

This is what keeps the token surface manageable.

### 4. Hot-reload compatibility

Because skills can be reloaded and eventually hot-added, the discovery dataset must be rebuilt automatically from currently loaded manifests rather than treated as a static one-time compilation artifact.

### 5. Forward-looking optional ideas noted at concept time

These were part of the broader idea-space, but not all were mandatory for the first implementation tranche:

- read-only user-facing `/skillSearch` access for chat participants
- future virtual-employee-facing skill visibility / steering aids
- richer manifest search terms and discovery metadata
- orchestrator-specific metadata to help pair discovered skills with downstream model choice

## What shipped from this concept

The following parts of the concept are now materially present in the repo:

- manifest-driven discovery metadata in the capability schema
- an in-memory discovery index rebuilt from loaded manifests
- core `helkin_skill_search` discovery tool
- discovery-first orchestration with second-hop selective tool injection
- telemetry and test coverage for the shipped discovery layer
- repo documentation and instruction backports for the delivered behavior

## What remained outside the first delivered slice

The following concept-adjacent items were not fully delivered as part of the core discovery-layer implementation:

- user-facing read-only `/skillSearch` slash command / chat entry point
- downstream use of `modelAffinity` / routing breadcrumbs after discovery
- stronger deterministic follow-up selection for certain action-oriented flows
- richer search/ranking behavior beyond the current heuristic scoring model

Those are follow-on improvements rather than evidence that the core discovery-layer delivery never happened.

## Current repo-reality note

The main open design-completeness gap currently visible is not “does discovery exist?” but “does discovery always narrow correctly for concrete action flows?”

One current example is tracked in:

- `#394` — discovery-first calendar routing stalls at `helkin_skill_search` instead of reaching event-creation tools

That issue reflects a real follow-through gap in action-oriented manifest metadata and second-hop routing, not a total absence of the discovery-layer architecture itself.