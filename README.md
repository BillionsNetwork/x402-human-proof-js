# x402-human-proof

Human verification extension for the [x402 payment protocol](https://github.com/coinbase/x402). Lets API providers gate access to verified humans and offer discounted pricing to those who hold a [Billions Network](https://billions.network) Proof-of-Uniqueness (PoU) attestation.

## Packages

| Package | Description |
|---------|-------------|
| `@0xpolygonid/x402-human-proof` | Server SDK — challenge generation, signature verification, PoU registry lookup |
| `@0xpolygonid/x402-human-proof-client` | Client SDK — EVM challenge signing, attestation checks, x402 extension |

---

## How It Works

```
Client                                  Server
  │                                        │
  │──── GET /resource ────────────────────►│
  │                                        │ 402 PaymentRequired
  │◄─── {payment options, human-proof ─────│     + CAIP-122 challenge
  │      challenge (nonce, domain, uri)} ──│
  │                                        │
  │  sign challenge with EVM wallet        │
  │  check attestations                    │
  │  select payment option                 │
  │                                        │
  │──── GET /resource ────────────────────►│
  │     X-PAYMENT: {...,                   │ verify signature
  │       extensions: {                    │ resolve DID → human
  │         "human-proof": <signed proof>  │ check extra attestations
  │       }}                               │
  │                                        │
  │◄─── 200 OK ─────────────────────────── │
```

The server always includes `DEFAULT_AGENT_OWNERSHIP_SCHEMA` in the challenge's `requiredAttestations`. Clients without the attestation receive a `MissingAttestationsError` before payment is attempted.

---

## Server Setup

```typescript
import { x402ResourceServer, paymentMiddleware } from '@x402/express'
import {
  configureHumanProofServer,
  declareHumanProofExtension,
  DEFAULT_AGENT_OWNERSHIP_SCHEMA,
} from '@0xpolygonid/x402-human-proof'

// 1. Create the x402 resource server
const server = new x402ResourceServer(facilitatorClient)
  .register('eip155:84532', new ExactEvmScheme())

// 2. Register the extension and verification hook in one call
configureHumanProofServer(server, {
  storage,   // implements HumanUsageStorage (required when using maxUse)
  onEvent: (event) => {
    if (event.type === 'human_verified') {
      console.log(
        `Human ${event.humanId} verified at ${event.verifiedAt}. ` +
        `Attestation ID: ${event.attestationId}. ` +
        `Agent: ${event.agentAddress} (${event.agentDid}). ` +
        `Human: ${event.humanAddress} (${event.humanDid})`,
      )
    }
    if (event.type === 'human_not_registered') {
      console.warn(`Unregistered DID: ${event.did}`)
    }
    if (event.type === 'max_use_exceeded') {
      console.warn(`Human ${event.humanId} hit limit of ${event.maxUse}`)
    }
  },
})

// 3. Declare protection and payment options on each route
app.use(paymentMiddleware({
  'GET /data': {
    accepts: [
      // Standard price — any payer
      { scheme: 'exact', price: '$0.01', network: 'eip155:84532', payTo: evmAddress },
      // Discounted price — verified humans only
      {
        scheme: 'exact',
        price: '$0.006',
        network: 'eip155:84532',
        payTo: evmAddress,
        extra: {
          requiredAttestations: [DEFAULT_AGENT_OWNERSHIP_SCHEMA],
          maxUse: 1,
          scope: 'data_report',   // optional: isolate quota per route
        },
      },
    ],
    extensions: {
      'human-proof': declareHumanProofExtension({
        statement: 'By signing, you provide a human proof',
        expirationSeconds: 900,
      }),
    },
  },
}, server))
```

---

## Client Setup

### With x402 client (recommended)

```typescript
import { x402Client, wrapAxiosWithPayment } from '@x402/axios'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { privateKeyToAccount } from 'viem/accounts'
import {
  createHumanProofExtension,
  createAttestationAwareSelector,
  buildDIDFromAddress,
  MissingAttestationsError,
} from '@0xpolygonid/x402-human-proof-client'

const signer = privateKeyToAccount(privateKey)
const did = buildDIDFromAddress(signer.address)

// Selector picks the discounted option when the client holds required attestations
const { selector, refresh } = createAttestationAwareSelector(did)
await refresh() // pre-populate attestation cache

const x402 = new x402Client(selector)
x402.register('eip155:*', new ExactEvmScheme(signer))

// Re-check attestations before each payment (picks up newly acquired ones)
x402.onBeforePaymentCreation(async () => { await refresh() })

// Automatically signs the human-proof challenge on each 402 response
x402.registerExtension(createHumanProofExtension({
  address: signer.address,
  signMessage: (msg: string) => signer.signMessage({ message: msg }),
}))

// Surface missing attestation errors to the user
x402.onPaymentCreationFailure(async ({ error }) => {
  if (error instanceof MissingAttestationsError) {
    console.error('Missing attestations:', error.attestationRequirements)
  }
})

const api = wrapAxiosWithPayment(axios.create(), x402)
const response = await api.get('https://api.example.com/data')
```

### Manual signing (advanced)

For frameworks that don't use the x402 client:

```typescript
import {
  signHumanProofChallengeEVM,
  extractHumanProofChallenge,
  checkAttestation,
  buildDIDFromAddress,
} from '@0xpolygonid/x402-human-proof-client'

const response = await fetch('/data')
if (response.status === 402) {
  const body = await response.json()
  const challenge = extractHumanProofChallenge(body)
  if (!challenge) throw new Error('No human-proof challenge in 402 response')

  const did = buildDIDFromAddress(signer.address)
  const hasAttestation = await checkAttestation(did, challenge.info.requiredAttestations[0])
  if (!hasAttestation) throw new Error('Missing attestation — complete PoU registration first')

  const signedProof = await signHumanProofChallengeEVM(challenge, signer, 'eip155:84532')

  // Retry via x402 client with the signed proof in extensions
}
```

---

## Discounted Pricing

The `createAttestationAwareSelector` reads `extra.requiredAttestations` on each payment option and automatically picks the discounted one when the client holds all required attestations:

```typescript
// Schemas to check (defaults to DEFAULT_AGENT_OWNERSHIP_SCHEMA)
const { selector, refresh, disqualify } = createAttestationAwareSelector(
  did,
  [DEFAULT_AGENT_OWNERSHIP_SCHEMA],       // schemas to hold for discount
  { attestationsApiBaseUrl: '...' },      // optional: override API URL
)

// Refresh inside onBeforePaymentCreation to always have current attestations
x402.onBeforePaymentCreation(async () => { await refresh() })
```

If no discounted option matches, the selector falls back to the first option without `requiredAttestations`.

### Usage limits (`maxUse`)

Set `extra.maxUse` on a discounted accept to cap how many times a verified human can use that price. The server enforces this atomically via `HumanUsageStorage`. When the limit is reached the server returns a `max_use_exceeded` error and the client should retry at full price:

```typescript
// Server — pass storage to configureHumanProofServer
configureHumanProofServer(server, {
  storage,   // implements HumanUsageStorage
  onEvent: (event) => {
    if (event.type === 'max_use_exceeded') {
      console.warn(`Human ${event.humanId} hit limit of ${event.maxUse}`)
    }
  },
})

// Route — set maxUse (and optionally scope) on the discounted accept
extra: {
  requiredAttestations: [DEFAULT_AGENT_OWNERSHIP_SCHEMA],
  maxUse: 10,
  scope: 'my_route',   // optional: isolates quota per route (defaults to resource URL)
}

// Client — detect the error and retry at full price
try {
  response = await api.get(url)
} catch (err) {
  if (isMaxUseExceededError(err)) {
    disqualify()              // selector skips discounted option on next call
    response = await api.get(url)
  }
}
```

---

## Configuration

### Server

#### `configureHumanProofServer(server, options?)`

Convenience function that registers the extension and wires all hooks in one call. Prefer this over calling the lower-level functions individually.

| Option | Type | Description |
|--------|------|-------------|
| `extensionOptions` | `CreateHumanProofExtensionOptions` | Options forwarded to `createHumanProofExtension` |
| `verifier` | `PoUVerifier` | Custom verifier instance. Takes precedence over `verifierOptions` |
| `verifierOptions` | `PoUVerifierOptions` | Options passed to the default `createPoUVerifier` |
| `onEvent` | `(event: HumanProofEvent) => void` | Callback for `human_verified`, `human_not_registered` and `max_use_exceeded` events |
| `storage` | `HumanUsageStorage` | Required when any `accept` sets `extra.maxUse`. Also wires rollback hooks automatically. |

> **Production note:** `HumanUsageStorage` is an interface — implement it with a persistent backend (Redis, database, etc.) so usage counts survive restarts and work across multiple server instances. The `incrementIfBelow` method must be a single atomic operation (e.g. Redis Lua script, SQL `UPDATE ... WHERE count < maxUse RETURNING count`) to prevent races under concurrent requests. The `InMemoryHumanUsageStorage` in the examples directory is for development only.

#### `createHumanProofExtension(options?)`

Builds the CAIP-122 challenge included in 402 responses.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agentOwnershipSchema` | `string` | `DEFAULT_AGENT_OWNERSHIP_SCHEMA` | Must match the schema configured in your verifier |

#### `declareHumanProofExtension(options)`

Declares human-proof protection on a route.

| Option | Type | Description |
|--------|------|-------------|
| `statement` | `string` | Human-readable statement shown in the SIWE message |
| `expirationSeconds` | `number` | Challenge validity window. If omitted, no expiration is set |
| `resourceUri` | `string` | Override resource URI (defaults to request URL) |
| `network` | `string \| string[]` | Restrict to specific CAIP-2 networks |

#### `createVerifyHumanProofHook(options?)`

Low-level hook for `server.onBeforeVerify`. Use `configureHumanProofServer` instead unless you need fine-grained control.

| Option | Type | Description |
|--------|------|-------------|
| `verifier` | `PoUVerifier` | Custom verifier instance. Takes precedence over `verifierOptions` |
| `verifierOptions` | `PoUVerifierOptions` | Options passed to the default `createPoUVerifier` |
| `onEvent` | `(event: HumanProofEvent) => void` | Callback for `human_verified`, `human_not_registered` and `max_use_exceeded` events |
| `storage` | `HumanUsageStorage` | Required when any `accept` sets `extra.maxUse`. Tracks per-human usage counts. |

#### `createPoUVerifier(options?)`

Creates the default PoU verifier that queries the Billions Network explorer.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agentOwnershipSchema` | `string` | `DEFAULT_AGENT_OWNERSHIP_SCHEMA` | Schema ID used to look up human registration |
| `attestationsApiBaseUrl` | `string` | `DEFAULT_ATTESTATIONS_API_BASE_URL` | Attestations API endpoint |
| `hasAttestation` | `(did, chainId, schema) => Promise<boolean>` | Explorer API | Override attestation check (e.g. for testing) |

### Client

#### `createHumanProofExtension(signer, options?)`

x402 client extension. Checks attestations and signs the challenge automatically.

| Option | Type | Description |
|--------|------|-------------|
| `attestationsApiBaseUrl` | `string` | Override attestations API endpoint |

---

## API Reference

### Server (`@0xpolygonid/x402-human-proof`)

```typescript
// x402 integration
configureHumanProofServer(server: x402ResourceServer, options?: ConfigureHumanProofServerOptions): void
createHumanProofExtension(options?: CreateHumanProofExtensionOptions): ResourceServerExtension
createVerifyHumanProofHook(options?: CreateVerifyHumanProofHookOptions): BeforeVerifyHook
declareHumanProofExtension(options: DeclareHumanProofOptions): HumanProofDeclaration

// Rollback hooks (wired automatically by configureHumanProofServer when storage is provided)
createAfterVerifyFailureRollbackHook(options: { storage: HumanUsageStorage; verifier: PoUVerifier }): AfterVerifyHook
createVerifyFailureRollbackHook(options: { storage: HumanUsageStorage; verifier: PoUVerifier }): VerifyFailureHook
createSettleFailureRollbackHook(options: { storage: HumanUsageStorage; verifier: PoUVerifier }): SettleFailureHook

// Verifier
createPoUVerifier(options?: PoUVerifierOptions): PoUVerifier

// Direct verification (for custom integrations)
verifyHumanProofRequest(verifier: PoUVerifier, context: HumanProofRequestContext): Promise<HumanProofRequestResult>

// Constants
DEFAULT_AGENT_OWNERSHIP_SCHEMA: string
DEFAULT_ATTESTATIONS_API_BASE_URL: string
HUMAN_PROOF: 'human-proof'
HUMAN_PROOF_HEADER: 'HUMAN-PROOF'
```

### Client (`@0xpolygonid/x402-human-proof-client`)

```typescript
// x402 integration
createHumanProofExtension(signer: EVMSigner, options?: HumanProofExtensionOptions): ClientExtension
createAttestationAwareSelector(did: string, schemas?: string[], options?: { attestationsApiBaseUrl?: string }): AttestationAwareSelector
// AttestationAwareSelector: { selector, refresh, disqualify }
// call disqualify() after isMaxUseExceededError() to force full-price on retry

// Manual signing
signHumanProofChallengeEVM(challenge: HumanProofChallenge, signer: EVMSigner, chainId: string): Promise<string>
extractHumanProofChallenge(paymentRequired: { extensions?: Record<string, unknown> }): HumanProofChallenge | null

// Utilities
buildDIDFromAddress(ethAddress: string): string
checkAttestation(did: string, schemaId: string, options?: { attestationsApiBaseUrl?: string }): Promise<boolean>
isMaxUseExceededError(err: unknown): boolean

// Constants
DEFAULT_AGENT_OWNERSHIP_SCHEMA: string
DEFAULT_ATTESTATIONS_API_BASE_URL: string
```

---

## Types

```typescript
type HumanResolution = {
  humanId: string        // Verified human ID from the PoU registry
  verifiedAt: string     // ISO 8601 timestamp of registration
  attestationId: string  // On-chain attestation ID
  humanDid: string       // DID of the human
  humanAddress: string   // EVM address of the human
  agentDid: string       // DID of the agent wallet
  agentAddress: string   // EVM address of the agent wallet
}

type HumanVerifiedEvent = {
  type: 'human_verified'
  resource: string
  humanId: string
  verifiedAt: string
  attestationId: string
  humanDid: string
  humanAddress: string
  agentDid: string
  agentAddress: string
}

type HumanNotRegisteredEvent = {
  type: 'human_not_registered'
  resource: string
  did: string
}

type MaxUseExceededEvent = {
  type: 'max_use_exceeded'
  resource: string
  humanId: string
  maxUse: number
}

interface PoUVerifier {
  ownershipSchema: string
  lookupHuman(did: string, chainId: string): Promise<HumanResolution | null>
  hasAttestation?(did: string, chainId: string, schema: string): Promise<boolean>
}

type EVMSigner = {
  address: string
  signMessage(message: string): Promise<string>
}
```

---

## Error States

| Reason | Description |
|--------|-------------|
| `missing_header` | No human-proof extension in payment payload |
| `invalid_header` | Payload is not valid JSON or missing required fields |
| `invalid_message` | CAIP-122 message fields invalid (bad URI, expired, malformed date) |
| `invalid_signature` | Signature does not match the address |
| `not_registered` | Wallet DID not found in PoU registry |
| `missing_required_attestation` | DID is missing an extra attestation required by the payment option |
| `verifier_cannot_check_attestations` | Custom verifier does not implement `hasAttestation` but extra schemas are required |

---

## Development

```bash
npm install
npm run build        # build all packages
npm run dev          # watch mode
```
