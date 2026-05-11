# @billionsnetwork/x402-human-proof-server

Server package for x402 human-proof integrations.

## Features

- Human-proof verification helpers for server-side integrations.
- TypeScript types included.
- ESM and CJS outputs.

## Installation

```bash
npm install @billionsnetwork/x402-human-proof-server
```

## Usage

```ts
import {
	configureHumanProofServer,
	declareHumanProofExtension,
	DEFAULT_AGENT_OWNERSHIP_SCHEMA,
} from "@billionsnetwork/x402-human-proof-server";

// 1) Declare human-proof requirements for your protected route
const resourceDeclaration = declareHumanProofExtension({
	statement: "By signing, you provide a human proof",
	expirationSeconds: 900,
});

// 2) Register extension + verification hooks on your x402 server
configureHumanProofServer(server, {
	storage,
	onEvent: (event) => console.log(event.type),
});

// 3) Attach declaration in your route payment config
const accepts = [
	{
		scheme: "exact",
		price: "$0.006",
		network: "eip155:84532",
		payTo: evmAddress,
		extra: {
			requiredAttestations: [DEFAULT_AGENT_OWNERSHIP_SCHEMA],
			maxUse: 1,
			scope: "weather_report",
		},
	},
];

const extensions = {
	"human-proof": resourceDeclaration,
};
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
