## Overview

`@billionsnetwork/x402-human-proof-client` is the **client SDK** for agents and humans calling a service that require per-request payments and human-backed verification powered by x402 human proof server sdk.

It enables clients to:

- **Sign CAIP-122 (SIWE) challenges** embedded in `402` responses so the server can verify the agent is operated by a real human.
- **Check held attestations** against the [Billions Network](https://attestations-explorer.billions.network/) registry before attempting a payment, so attestation-gated (discounted) pricing tiers are selected only when the client qualifies.
- **Fall back gracefully** when attestations are missing (`MissingAttestationsError`) or when a per-human usage cap is hit (`isMaxUseExceededError` + `disqualify()`).

The SDK integrates with the x402 client lifecycle as a registered extension. It is framework-agnostic and compatible with any HTTP client library supported by `@x402`.

**Just want your agent to access human-proof protected APIs?** The [identity skill](https://billions.network/verified-agent-identity-skill-openclaw) is built on top of this SDK — install it and your agent is ready without any code changes. If your agent hasn't installed the skill yet, the paywall HTML returned by the server already includes instructions to do so, so pre-installation is not required.

---

## How It Works

```
  Client                              Server
    │                                    │
    │──── GET /resource ────────────────►│
    │◄─── 402 + human-proof challenge ───│
    │                                    │
    │  1. selector picks best tier       │
    │  2. extension signs challenge      │
    │  3. proof injected into payment    │
    │                                    │
    │──── GET /resource ────────────────►│
    │     X-PAYMENT with signed proof    │
    │◄─── 200 OK ────────────────────────│
```

- The selector runs synchronously at payment creation time; attestation state is cached and refreshed via `refresh()`.
- The extension re-checks attestations live just before signing — the selector cache and the live check serve different purposes: tier selection vs. proof construction.
- If the server returns `max_use_exceeded`, call `disqualify()` on the selector and retry — it will skip discounted tiers permanently for that instance.

---

## Installation

```bash
npm install @billionsnetwork/x402-human-proof-client @x402/axios @x402/evm viem
```

Requires Node.js >= 18 and an x402-compatible HTTP client. The agent wallet must hold a Billions Network PoU attestation to access discounted pricing tiers.

---

## Quick Start

```tsx
import { config } from "dotenv";
import { x402Client, wrapAxiosWithPayment } from "@x402/axios";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import axios from "axios";
import {
  createHumanProofExtension,
  createAttestationAwareSelector,
  buildDIDFromAddress,
  MissingAttestationsError,
  isMaxUseExceededError,
} from "@billionsnetwork/x402-human-proof-client";

config();

const evmSigner = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`);
const did = buildDIDFromAddress(evmSigner.address);

const { selector, refresh, disqualify } = createAttestationAwareSelector(did);
await refresh(); // pre-populate cache so selector has attestations on first use

const x402 = new x402Client(selector);
x402.register("eip155:*", new ExactEvmScheme(evmSigner));
x402.onBeforePaymentCreation(async () => { await refresh(); });
x402.registerExtension(
  createHumanProofExtension({
    address: evmSigner.address,
    signMessage: (msg) => evmSigner.signMessage({ message: msg }),
  }),
);
x402.onPaymentCreationFailure(async ({ error }) => {
  if (error instanceof MissingAttestationsError) {
    console.error("Missing attestations:", error.attestationRequirements);
  }
});

const api = wrapAxiosWithPayment(axios.create(), x402);

try {
  const response = await api.get("http://localhost:4021/weather");
  console.log(response.data);
} catch (err) {
  if (isMaxUseExceededError(err)) {
    disqualify(); // skip discounted tier for all future payments on this selector
    const response = await api.get("http://localhost:4021/weather");
    console.log(response.data);
  } else {
    throw err;
  }
}
```

---

## Core Concepts

### The Human-Proof Challenge

When the server is configured with `@billionsnetwork/x402-human-proof`, its `402` responses include an `extensions["human-proof"]` object:

```json
{
  "human-proof": {
    "info": {
      "domain": "localhost",
      "uri": "http://localhost:4021/weather",
      "version": "1",
      "nonce": "1ab399792f4c9b05ac916fdf4fd9ac6c",
      "issuedAt": "2026-04-22T11:18:52.428Z",
      "expirationTime": "2026-04-22T11:33:52.428Z",
      "statement": "By signing, you provide a human proof",
      "resources": ["http://localhost:4021/weather"],
      "requiredAttestations": [
        "0xca354bee6dc5eded165461d15ccb13aceb6f77ebbb1fd3fe45aca686097f2911"
      ]
    },
    "supportedChains": [
      { "chainId": "eip155:84532", "type": "eip191" }
    ]
  }
}
```

`createHumanProofExtension` handles signing and proof construction automatically when registered with the x402 client.

### CAIP-122 / SIWE Signing

[CAIP-122](https://chainagnostic.org/CAIPs/caip-122) defines chain-agnostic message signing. For EVM chains the SDK uses Sign-In with Ethereum (SIWE / eip191). `signHumanProofChallengeEVM` handles message formatting and signing; `createHumanProofExtension` calls it automatically — use it directly only if you need lower-level control.

## Configuration Reference

### `createHumanProofExtension(signer, options?)`

Register this extension on your x402 client to handle challenge signing automatically. On each payment attempt it extracts the `human-proof` challenge from the `402` body, verifies the wallet holds all required attestations, and injects the signed proof into the payment payload.

```tsx
import { createHumanProofExtension } from "@billionsnetwork/x402-human-proof-client";

x402.registerExtension(createHumanProofExtension(signer, options));
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `signer` | `EVMSigner` | EVM signing interface — must have `address: string` and `signMessage(msg: string): Promise<string>`. |
| `options` | `HumanProofExtensionOptions` | Optional configuration. |

**`HumanProofExtensionOptions`:**

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `attestationsApiBaseUrl` | `string` | `DEFAULT_ATTESTATIONS_API_BASE_URL` | Override the Billions Network attestations API URL used for pre-sign attestation checks. |

If no challenge is present in the `402` body the payload is returned unchanged. Otherwise it checks each required attestation schema (throwing `MissingAttestationsError` if any are missing), signs the SIWE message with the first `eip191`/`eip1271` chain, and returns the payload with `extensions["human-proof"]` set.

**Compatibility note:** The `EVMSigner` interface is intentionally minimal. It is compatible with:

```tsx
// viem WalletClient
const signer: EVMSigner = {
  address: walletClient.account.address,
  signMessage: (msg) => walletClient.signMessage({ message: msg }),
};

// viem LocalAccount (privateKeyToAccount)
const signer: EVMSigner = {
  address: account.address,
  signMessage: (msg) => account.signMessage({ message: msg }),
};

// ethers v6 Signer
const signer: EVMSigner = {
  address: await ethersSigner.getAddress(),
  signMessage: (msg) => ethersSigner.signMessage(msg),
};
```

---

### `createAttestationAwareSelector(did, schemas?, options?)`

Creates a selector + `refresh` + `disqualify` triple for use with `new x402Client(selector)`. The selector picks the most favorable `accepts` entry based on cached attestation state.

```tsx
import {
  createAttestationAwareSelector,
  buildDIDFromAddress,
} from "@billionsnetwork/x402-human-proof-client";

const did = buildDIDFromAddress(evmSigner.address);
const { selector, refresh, disqualify } = createAttestationAwareSelector(did);

await refresh();
const x402 = new x402Client(selector);
x402.onBeforePaymentCreation(async () => { await refresh(); });
```

**Parameters:**

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `did` | `string` | — | The client’s DID. Use `buildDIDFromAddress(address)` to derive it. |
| `schemas` | `string[]` | `[DEFAULT_AGENT_OWNERSHIP_SCHEMA]` | Schema IDs to check and cache. Must include all schemas present in the server’s `requiredAttestations` for the selector to enable discounted tiers. |
| `options.attestationsApiBaseUrl` | `string` | `DEFAULT_ATTESTATIONS_API_BASE_URL` | Override the attestations API URL. |

**Returns:**

| Member | Type | Description |
| --- | --- | --- |
| `selector` | `(_version, requirements) => PaymentRequirements` | Synchronous selector. Pass directly to `new x402Client(selector)`. |
| `refresh` | `() => Promise<void>` | Re-fetches attestation state from the registry. Call this inside `onBeforePaymentCreation`. |
| `disqualify` | `() => void` | Permanently forces the selector to skip discounted options on this instance. Call when `isMaxUseExceededError` returns true. Not reset by `refresh()` — create a new `createAttestationAwareSelector` instance to re-enable discounted selection. |

---

### `buildDIDFromAddress(ethAddress)`

Derives the Billions Network DID from an EVM wallet address. The DID is needed for attestation lookups and for `createAttestationAwareSelector`.

```tsx
import { buildDIDFromAddress } from "@billionsnetwork/x402-human-proof-client";

const did = buildDIDFromAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
// → "did:iden3:billions:main:..."
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `ethAddress` | `string` | Checksummed or lowercase EVM address. |

**Returns:** `string` — the full DID string using the `did:iden3:billions:main:` method.

---

### `checkAttestation(did, schemaId, options?)`

Queries the Billions Network attestations API to check whether a DID holds at least one attestation matching a given schema ID.

```tsx
import { checkAttestation, DEFAULT_AGENT_OWNERSHIP_SCHEMA } from "@billionsnetwork/x402-human-proof-client";

const held = await checkAttestation(did, DEFAULT_AGENT_OWNERSHIP_SCHEMA);
console.log(held); // true or false
```

**Parameters:**

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `did` | `string` | — | The DID to check. |
| `schemaId` | `string` | — | The attestation schema ID. |
| `options.attestationsApiBaseUrl` | `string` | `DEFAULT_ATTESTATIONS_API_BASE_URL` | Override the API base URL. |

**Returns:** `Promise<boolean>` — `true` if at least one matching attestation record exists. 

---

## Low-level helpers

### `signHumanProofChallengeEVM(challenge, signer, chainId)`

Lower-level function that signs a CAIP-122 challenge for an EVM chain and returns the JSON proof string. `createHumanProofExtension` calls this internally.

```tsx
import { signHumanProofChallengeEVM } from "@billionsnetwork/x402-human-proof-client";

const proofJson = await signHumanProofChallengeEVM(challenge, signer, "eip155:84532");
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `challenge` | `HumanProofChallenge` | The `extensions["human-proof"]` object from the 402 response. |
| `signer` | `EVMSigner` | EVM signing interface. |
| `chainId` | `string` | CAIP-2 chain ID to use (e.g. `"eip155:84532"`). Must exist in `challenge.supportedChains`. |

**Returns:** `Promise<string>` — a JSON-encoded string containing all CAIP-122 fields plus `address`, `signature`, `chainId`, and `type`. This is the value to place in `paymentPayload.extensions["human-proof"]`.

**Throws:** `Error` if `chainId` is not in `challenge.supportedChains` with type `eip191` or `eip1271`.

---

### `extractHumanProofChallenge(paymentRequired)`

Extracts the `human-proof` extension object from a `402` response body. Returns `null` if no challenge is present — safe to call on any `paymentRequired` response.

```tsx
import { extractHumanProofChallenge } from "@billionsnetwork/x402-human-proof-client";

const challenge = extractHumanProofChallenge(paymentRequired);
if (challenge) {
  console.log(challenge.info.nonce);
  console.log(challenge.supportedChains);
}
```

**Parameters:**

| Parameter | Type | Description |
| --- | --- | --- |
| `paymentRequired` | `{ extensions?: Record<string, unknown> }` | The `402` response body or any object with an `extensions` field. |

**Returns:** `HumanProofChallenge | null`

---

## Error Handling

### `MissingAttestationsError`

Thrown by `createHumanProofExtension` when the wallet doesn't hold one or more required attestations.

```tsx
x402.onPaymentCreationFailure(async ({ error }) => {
  if (error instanceof MissingAttestationsError) {
    console.error(
      "You need to complete these attestations before accessing the discounted tier:",
      error.attestationRequirements,
      // [{ schemaId: "0xca354bee6dc5eded..." }]
    );
    // Redirect the user to complete their Billions Network registration
  }
});
```

| Property | Type | Description |
| --- | --- | --- |
| `attestationRequirements` | `AttestationRequirement[] \\| undefined` | One `{ schemaId: string }` entry per missing attestation. |

Expect this when one or more schemas in `challenge.info.requiredAttestations` are not held by the DID — either the user hasn't completed Billions Network registration yet, or the DID was derived from a different wallet than the one that holds the attestation.

---

### `isMaxUseExceededError`

Returns `true` when an HTTP error response has status `402` and the `payment-required` header contains `error: "max_use_exceeded"`. This happens when the server’s per-human usage cap for a discounted tier has been reached.

```tsx
try {
  response = await api.get(url);
} catch (err) {
  if (isMaxUseExceededError(err)) {
    disqualify(); // permanently skip discounted tiers for this selector
    response = await api.get(url); // retry — selector now picks standard pricing
  } else {
    throw err;
  }
}
```

Returns `boolean`. Works with both `fetch`-style responses (headers with a `.get(name)` method) and plain object headers (`Record<string, string | string[]>`), so it is compatible with `axios`, `fetch`, `node-fetch`, and similar.

---

## Environment Variables

The example client uses:

| Variable | Description |
| --- | --- |
| `EVM_PRIVATE_KEY` | `0x`-prefixed hex private key for the agent wallet |
| `RESOURCE_SERVER_URL` | Base URL of the x402 resource server (default: `http://localhost:4021`) |
| `ENDPOINT_PATH` | Path to the protected endpoint (default: `/weather`) |