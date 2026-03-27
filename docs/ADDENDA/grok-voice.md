```markdown
# Comprehensive Guide: Integrating Grok Voice (Real-Time Speech-to-Speech with Ara) into Your Microsoft Teams Chatbot-Agent Orchestration System

**Last updated:** March 26, 2026  
**Author:** Grok (xAI) – based on our full conversation thread  
**Goal:** Add low-latency voice-to-voice capability (Grok models + Ara voice) to your existing TypeScript-based Teams bot that already routes text messages through durable functions → Azure AI Foundry.  

This guide focuses on the **production-viable path we converged on**: a thin Windows VM running the official Microsoft Graph Calls Media SDK (.NET) for raw PCM access from Teams calls. It keeps your existing durable-functions orchestration intact while adding real-time bidirectional audio streaming to xAI’s Grok Voice Agent WebSocket API.

---

## 1. High-Level Architecture

```
Teams Client (call button in channel)
    ↓ (Graph API call creation)
Azure Durable Functions (TypeScript v4 – your existing orchestrator)
    ↓ (HTTP trigger / VM start)
Windows B1s Burstable VM (headless, hibernated)
    ├── .NET Media Bot (Graph Communications SDK)
    │     ├── Receives raw 16 kHz 16-bit mono PCM from Teams
    │     ├── Base64-encodes 20 ms chunks
    │     └── WebSocket client → xAI Grok Voice API
    │
    └── Bidirectional stream:
          PCM chunks (base64) ↔ xAI (speech-to-speech with VAD server-side)
          Response audio deltas (base64 PCM) → decode → inject back into Teams media socket
```

- **Your existing layers stay untouched** (durable functions handle agentic routing, tool calls, Azure AI Foundry fallback, etc.).
- The VM is **only** the real-time media termination point (single call at a time for your dev setup).
- Cold-start latency is solved with **Azure VM hibernation** (10–30 s resume).

---

## 2. xAI Grok Voice API (Bleeding-Edge Real-Time)

- Endpoint: `wss://api.x.ai/v1/realtime`
- Protocol: WebSocket (OpenAI-compatible SDK works with base URL override)
- Audio format: **16 kHz, 16-bit mono linear PCM** (uncompressed)
- Chunk size: **20 ms** (320 samples) → base64-encoded in `input_audio_buffer.append`
- Server-side VAD (voice activity detection) on Grok → natural turn-taking, no client-side silence detection
- Voices: Ara + others (real-time speech-to-speech)
- Pricing: Pay-per-token (≈ $2 / M input tokens) + free starter credits at console.x.ai
- Auth: `Authorization: Bearer $XAI_API_KEY`

**Important note on API key (the part you asked me to automate):**  
I cannot use Playwright, MCP tooling, or any browser automation to sign up, log in, or create keys on https://console.x.ai. That would require your credentials and violates security boundaries.  
**Action required from you:**  
1. Go to https://console.x.ai  
2. Sign in with your X account  
3. Create a new API key  
4. Store it in your existing Azure Key Vault named `stamp` (secret name e.g. `xai-grok-voice-key`)  
5. Your durable functions and VM will read it via `DefaultAzureCredential` + `SecretClient`.

---

## 3. Teams Voice Integration – Why the Windows VM Path?

Microsoft Graph Calls / Meetings bots require the **Skype.Bots.Media** library for raw PCM sockets. It is **Windows-only** (even in .NET 6/8+). No Linux, no pure serverless Functions, no browser WebRTC bypass for bots.

**Closest alternatives we discussed (and why we didn’t pick them for live voice):**
- **Azure Communication Services (ACS) bots** – Linux/Node.js friendly, WebSocket PCM, but requires Teams interop policy and proxies through Azure (adds ~200–400 ms latency, no raw Teams media control).
- **Post-call transcripts / real-time captions** – Text-only, no live audio stream.
- **Custom tabs / browser client** – Cannot access call audio streams.

**Raw PCM via Windows VM is still the cleanest for true low-latency Grok voice.**

---

## 4. Cheapest & Fastest VM Configuration (Burstable + Hibernation)

| Item                        | Recommendation                              | Monthly Cost (West Europe, Dev/Test pricing) | Notes |
|-----------------------------|---------------------------------------------|----------------------------------------------|-------|
| VM SKU                      | B1s (2 vCPU, 1 GiB RAM)                     | ~€2–3 (hibernated)                           | Burstable – credits for media spikes |
| OS                          | Windows Server 2022 Datacenter – **Azure Edition (minimal)** | Included in VM price                         | Headless, no GUI |
| Disk                        | Premium SSD P15 (128 GiB)                   | ~€8                                          | Required for hibernation |
| Hibernation                 | Enabled                                     | 0 € while hibernated                         | Resume 10–30 s |
| Image                       | Custom generalized image (pre-baked .NET bot) | —                                            | See section 5 |

**Hibernation hack summary:**
- VM starts in **Stopped (deallocated)** state most of the time → zero compute cost.
- Durable function calls `VirtualMachinesClient.Start()` → Azure resumes from disk in 10–30 s.
- Teams call policy: set “answer timeout” to 30 s in Graph (or use recording bot policy for 5 s instant join).

**Startup optimizations you can apply:**
- Disable Windows Defender real-time scan, Windows Update, telemetry, GUI services.
- Pre-install .NET 8 runtime + Graph SDK + your bot binary as a Windows Service (NSSM).
- Use Azure Run Command post-resume to ensure bot is listening before Graph call creation.
- Optional: Azure Spot B1ls (even cheaper, 0.5 GiB variant) if you accept occasional eviction.

---

## 5. .NET Media Bot Implementation (Turnkey Starting Point)

1. Clone the official sample:  
   https://github.com/microsoftgraph/microsoft-graph-comms-samples/tree/master/Samples/V1.0-Samples/LocalMediaSamples/PolicyRecordingBot
2. Replace the recording logic with:
   - WebSocket client to `wss://api.x.ai/v1/realtime`
   - 20 ms timer that base64-encodes PCM frames and sends `input_audio_buffer.append`
   - On `response.audio.delta` events: decode base64 → `AudioSender.SendAsync()` back into Teams media socket
3. Build as console app or Windows Service.
4. Deploy to VM via custom Azure Image (generalized).
5. Auto-start on boot via Task Scheduler or NSSM.

**Code skeleton (key parts):**
```csharp
// In MediaPlatform.OnAudioDataReceived
byte[] pcmChunk = ...; // 320 samples, 16kHz mono
string base64 = Convert.ToBase64String(pcmChunk);
await _xaiWebSocket.SendAsync(new { type = "input_audio_buffer.append", audio = base64 });

// On xAI response audio
byte[] decodedPcm = Convert.FromBase64String(xaiDelta.Audio);
await _audioSender.SendAsync(decodedPcm);
```

Full duplex is native in the SDK – no extra hops.

---

## 6. Orchestration Layer (Your Existing TypeScript Durable Functions)

- **Activity function** `StartVoiceBotVM()` → Azure SDK `vmClient.start()`
- **Activity function** `CreateTeamsCall()` → Graph `/communications/calls` POST (with bot callback URI pointing at your VM’s public IP or App Service front-end)
- **Orchestrator** waits for VM ready signal (HTTP health check or Event Grid)
- On call end → `vmClient.deallocate()` or hibernate command
- Store xAI key in Key Vault → read via `SecretClient` in both durable functions and VM (use Managed Identity)

---

## 7. Streaming Mechanics (20 ms Chunks & Base64)

- Every 20 ms → 320 samples → base64 → WebSocket (binary-safe, no compression)
- xAI server VAD handles turn-taking
- Round-trip latency target: <700 ms end-to-end (VM + xAI)
- Base64 encode/decode overhead: microseconds per chunk (literally “a fart” on a B1s)

---

## 8. Security & Authentication

- VM uses System-Assigned Managed Identity
- Delegated permissions via Graph app registration (Calls.Initiate, Calls.Join, etc.)
- xAI key pulled from `stamp` Key Vault at runtime only
- VM firewall: only allow inbound from Microsoft Graph media IPs + your durable functions

---

## 9. Cost Estimate (Single-Call Dev Setup)

- VM hibernated 99 % of time → ≈ €10–15 / month total (including Premium SSD)
- xAI usage: pay-per-token (voice is cheap)
- No always-on cost thanks to hibernation

---

## 10. Limitations & Future-Proofing

- Windows VM lock-in is Microsoft’s current reality for raw media bots.
- If ACS interop policies improve, migrate to Linux/Node.js ACS bot for true serverless.
- Monitor xAI’s roadmap – they may add direct Teams connectors later.

---

## 11. Next Steps Checklist (You Do These Today)

1. [ ] Get xAI API key at https://console.x.ai and store in `stamp` Key Vault
2. [ ] Create custom Windows Server 2022 minimal image with pre-baked bot
3. [ ] Deploy B1s VM + enable hibernation + Premium SSD
4. [ ] Adapt PolicyRecordingBot sample for xAI WebSocket
5. [ ] Wire durable functions to start VM + create call
6. [ ] Test one call (press call button → hear Ara voice)

---

**You now have the complete blueprint.**  
Drop any specific code snippet, ARM template, or durable-function activity you want me to generate next and we’ll build it piece by piece.

Let’s make your Teams agent talk with Grok-level voice. Fire away with the next question!
```