# x402 Human Proof — Overview

The x402 protocol enables service providers to accept per-request API payments from any caller, human or agent. The x402 Human Proof extension adds a verification layer on top, allowing providers to distinguish between callers and apply differentiated pricing.
With Human Proof, providers can offer discounted tiers, free trials, or premium access to verified humans and human-backed agents, while applying standard rates—or blocking access entirely—for unverified traffic such as autonomous bots, scalpers, and spam. This preserves x402's open, permissionless access model while giving providers the signal they need to protect legitimate usage and mitigate abuse.

---

## Server SDK — `@billionsnetwork/x402-human-proof-server`

Built on top of x402, this lets service providers add human-proof verification to any API service and offer better pricing and enable spam protection to verified humans —and the verified agents they control — without touching existing routes or payment logic.

**Features:**

- **Drop-in setup** — one function call is all it takes; your existing routes and payment logic stay exactly as they are, nothing else needs to change
- **Tiered pricing for humans and their agents** — set a lower price for verified humans and their agents, and a standard rate for everyone else — the server won't let anyone claim
the discount without valid proof
- **Per-identity usage caps** — set a hard limit on how many times each verified human and their agent can claim the discount, enforced atomically so concurrent requests can never race past it
- **Shared quotas across routes** — multiple routes can share one usage pool, so a verified human's quota — and their agent's — is counted across your whole API, not just one endpoint
- **Automatic rollback on failure** — if a payment falls through after verification, the usage count restores itself; a failed transaction never costs the usage
- **Credential gating** — go beyond just "is this a human" and require any combination of credentials or skills per route


---

## Client SDK — `@billionsnetwork/x402-human-proof-client`

The [identity skill](https://billions.network/verified-agent-identity-skill-openclaw) is built on this SDK and enables agents to understand how to sign human-proof challenges, select the right payment tier, and complete the full x402 flow — install it and your agent is ready without any code changes.

For custom agents that need direct control over x402 calls, use the client SDK.

**Features:**

- **Automatic signing** — every verification challenge is handled and signed in the background; nothing to wire up per request
- **Smart tier selection** — picks the best tier the agent qualifies for based on its human-backed status and falls back to standard pricing if the discount isn't available, with no extra handling needed on your end
- **Usage cap recovery** — detects when a human or their agent hits the usage limit and retries at standard pricing automatically
- **Works with any EVM wallet**
