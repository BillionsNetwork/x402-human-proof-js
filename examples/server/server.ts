import { config } from "dotenv";
import express from "express";
import { x402ResourceServer, paymentMiddleware } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import {
  configureHumanProofServer,
  declareHumanProofExtension,
  DEFAULT_AGENT_OWNERSHIP_SCHEMA,
  type HumanProofEvent,
  paywallInstructions,
} from "@0xpolygonid/x402-human-proof";
import { PaymentRequired } from "@x402/express";
import { InMemoryHumanUsageStorage } from "./inMemoryHumanUsageStorage.js";

config();

const evmAddress = process.env.EVM_ADDRESS as `0x${string}`;
if (!evmAddress) {
  console.error("Missing required environment variable: EVM_ADDRESS");
  process.exit(1);
}

const facilitatorUrl = process.env.FACILITATOR_URL;
if (!facilitatorUrl) {
  console.error("FACILITATOR_URL environment variable is required");
  process.exit(1);
}

const useMockFacilitator = process.env.MOCK_FACILITATOR === "true";
const facilitatorClient = useMockFacilitator
  ? {
      verify: async () => ({ isValid: true, payer: evmAddress }),
      settle: async (_req: unknown) => ({
        success: true,
        transaction: "0xmocktx",
        network: "eip155:84532" as `${string}:${string}`,
        payer: evmAddress,
      }),
      supported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" as `${string}:${string}` }], extensions: [], signers: {} }),
      getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" as `${string}:${string}` }], extensions: [], signers: {} }),
    }
  : new HTTPFacilitatorClient({ url: facilitatorUrl });

// Declare which human-proof rules apply to the protected route
const resourceDeclaration = declareHumanProofExtension({
  statement: "By signing, you provide a human proof",
  expirationSeconds: 900, // 15 min challenge validity
});

const app = express();

const server = new x402ResourceServer(facilitatorClient)
  .register("eip155:84532", new ExactEvmScheme());

const storage = new InMemoryHumanUsageStorage();

configureHumanProofServer(server, {
  storage,
  onEvent: (event: HumanProofEvent) => {
    if (event.type === "human_verified") {
      console.log(`Human ${event.humanId} verified at ${event.verifiedAt}. Attestation ID: ${event.attestationId}. Address: ${event.address}. DID: ${event.did}`);
    }
    if (event.type === "human_not_registered") {
      console.warn(`Human not registered: ${event.did}`);
    }
    if (event.type === "max_use_exceeded") {
      console.warn(`Max use exceeded for human ${event.humanId} on resource ${event.resource} (limit: ${event.maxUse})`);
    }
  },
});

app.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.01",
            network: "eip155:84532",
            payTo: evmAddress,
          },
          {
            scheme: "exact",
            price: "$0.006",
            network: "eip155:84532",
            payTo: evmAddress,
            extra: {
              requiredAttestations: [DEFAULT_AGENT_OWNERSHIP_SCHEMA],
              maxUse: 1,
              scope: 'weather_report',
            }
          },
        ],
        description: "Weather data",
        mimeType: "application/json",
        unpaidResponseBody: async () => ({
          contentType: "text/html",
          body: paywallInstructions().generateHtml({} as PaymentRequired),
        }),
        extensions: {
          "human-proof": resourceDeclaration,
        },
      },
    },
    server,
    {},
    paywallInstructions(),
  ),
);

app.get("/weather", (_req, res) => {
  res.json({
    report: {
      weather: "sunny",
      temperature: 70,
    },
  });
});

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4021;

app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
  console.log(`Protected route: GET http://localhost:${PORT}/weather`);
});
