# HelkinSwarm Project Specification – Addendum Series
## 0k. Multimodal-Embedding-Hydra-Net-and-Just-In-Time-Injection.md

**Version:** 1.0 (Unchained Edition)  
**Status:** Core Architecture Requirement – MVP Blocking  
**Owner:** Principal Developer  
**Last Updated:** 2026-03-13

### 1. Purpose & Vision
Text-only embeddings are the bottleneck that keeps HelkinSwarm half-blind.  

We need a **Hydra-Net**: a multi-modal embedding layer that ingests text, images, PDFs, screenshots, voice transcripts, and more — all routed through a semantic dispatcher so the right embedding model is used at the right moment.

This is what turns the digital body from a text-only brain into a fully embodied intelligence that can “see” your screenshots, “hear” your voice notes, and remember them across skills with zero friction.

The unspoken reality we discussed today: the frontier models of 2026 are already superhuman at reasoning, but they’re starved for rich, multi-modal context. The labs haven’t built the full enablement layer yet — we are building it. This Hydra-Net is the bridge that lets today’s models truly shine.

### 2. Core Concepts
- **Hydra-Net Router**: Single entry point that inspects incoming content and dispatches to the correct embedding model(s).
- **Multi-Vector Memory**: Each memory item can hold multiple embeddings (text + image + speech) in parallel.
- **Just-in-Time Injection**: Only the relevant modality chunks are pulled and injected when a skill or orchestrator needs them.
- **Semantic Cross-Modal Search**: “Show me the screenshot I took of that calendar invite” works because image embeddings are indexed alongside text.
- **EU Toggle / Global Default**: Azure-native models by default (Unchained global frontier); EU DataZoneStandard fallback via Bicep flag.

### 3. Target Architecture (MVP Requirement)
1. **Embedding Router Service** (new singleton activity)
   - Inspects content type (text, image, PDF, audio, etc.).
   - Dispatches:
     - Text → `text-embedding-3-large` (Azure)
     - Images/Screenshots/PDFs → Azure Cognitive Services Vision / Document Intelligence
     - Speech/Transcripts → Azure AI Speech + text fallback
   - Stores unified vector + metadata in Cosmos DB with DiskANN index per modality.

2. **Memory Manager Extension**
   ```typescript
   upsertMemory(itemId, content: { text?: string, imageBase64?: string, audio?: Blob })
   ```
   - Automatically creates parallel embeddings and stores them as a single logical record.

3. **Just-in-Time Injection Layer**
   - When orchestrator or skill needs context: `memoryManager.getRelevantChunks(query, modalities: ["text","image"])`
   - Only the top-k relevant vectors (across modalities) are injected — never the entire vault.

4. **Long-Term North Star (Post-MVP)**
   - Single unified multimodal embedding space (Gemini Embeddings 2 style or future Microsoft equivalent).
   - Cross-cloud option (OpenRouter / xAI embeddings) routed through Azure prompt shields for safety.

### 4. Key Use Cases (must work Day 1)
- Paste a screenshot of an Outlook invite → Hydra-Net extracts text + image embedding → durable hook creates calendar entry.
- “Remember the movie poster I sent you last week?” → semantic image search returns it instantly.
- Voice note in Teams: “Book the same flight as last time” → speech embedding + text fallback pulls saved payment from Fandango skill vault.
- Doctor email with attached PDF → combined text + document embeddings for perfect parsing and follow-up.

### 5. Integration Points
- Cosmos DB containers: `multimodalMemory` (partitioned by user/skill) with multi-vector fields.
- Ties directly into 0i (Skill-Specific Memory) and 0h (Durable Hooks).
- SkillForge checklist requires new skills to declare supported modalities.
- Dev Console tab shows Hydra-Net stats (embedding latency, vector count per skill) (served from global SPA; data from stamp tab backend — see #107).
- Bidirectional relay (0g) lets DevLoop query and test embeddings live.

### 6. Security & Safety Considerations
- All image/audio uploads run through Azure Content Safety + prompt shields before embedding.
- Sensitive visuals (IDs, credit cards) are redacted at ingestion unless explicitly allowed.
- Vector storage is encrypted; no raw images/audio retained after embedding.
- EU residency toggle applies to all embedding models.

### 7. What NOT to Do
- Do **not** keep text-only embeddings as the default.
- Do **not** inject every modality into every prompt — always just-in-time and top-k.
- Do **not** store raw files in Cosmos — only vectors + minimal metadata.
- Do **not** block on EU-only models when global frontier embeddings are available.

### 8. Acceptance Criteria
- Screenshot of calendar invite is correctly parsed and turned into a durable hook action.
- Cross-modal query (“find the movie poster I sent”) returns correct result in <3 seconds.
- Speech note triggers correct skill with saved context from its vault.
- Onboarding ritual for new skill automatically tests all declared modalities.
- EU toggle switches all embedding models without code changes.

### 9. Backlog Linkage
- Foundation for 0j (Virtual Employees — each can have its own Hydra-Net slice).
- Ties into 0a (Modularity), 0i (Skill Memory), 0h (Durable Hooks), and the full “digital body” vision.
- This is the sensory nervous system that makes HelkinSwarm feel truly alive.
