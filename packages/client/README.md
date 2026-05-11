# @billionsnetwork/x402-human-proof-client

Client package for x402 human-proof integrations.

## Features

- Human-proof helpers for client-side flows.
- TypeScript types included.
- Node and browser outputs.

## Installation

```bash
npm install @billionsnetwork/x402-human-proof-client
```

## Usage

```ts
import {
	createHumanProofExtension,
	MissingAttestationsError,
	isMaxUseExceededError,
} from "@billionsnetwork/x402-human-proof-client";

// Register the extension on your x402 client
x402.registerExtension(
	createHumanProofExtension({
		address: evmSigner.address,
		signMessage: (msg) => evmSigner.signMessage(msg),
	}),
);

try {
	const response = await api.get(url);
	console.log(response.data);
} catch (err) {
	if (err instanceof MissingAttestationsError) {
		console.error("Missing attestations:", err.attestationRequirements);
	}
	if (isMaxUseExceededError(err)) {
		// Optional: refresh selector/attestations and retry
	}
}
```

## API

Public exports are available from the package root.

## Development

```bash
npm ci
npm run build
npm run dev
```

## Requirements

- Node.js >= 20.11.0

## License

UNLICENSED

## Notes

- Source code is in `src/`.
- Build output is generated in `dist/`.
- For project-wide setup and examples, see the repository root `README.md`.
