import { config } from "dotenv";
import { x402Client, wrapAxiosWithPayment, x402HTTPClient } from "@x402/axios";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import axios from "axios";
import { createHumanProofExtension, MissingAttestationsError, isMaxUseExceededError, buildDIDFromAddress, createAttestationAwareSelector } from "@0xpolygonid/x402-human-proof-client";

config();

const rawEvmPrivateKey = process.env.EVM_PRIVATE_KEY;
if (!rawEvmPrivateKey?.trim()) {
  throw new Error("Missing required environment variable: EVM_PRIVATE_KEY");
}
const evmPrivateKey = rawEvmPrivateKey as `0x${string}`;
const baseURL = process.env.RESOURCE_SERVER_URL || "http://localhost:4021";
const endpointPath = process.env.ENDPOINT_PATH || "/weather";
const url = `${baseURL}${endpointPath}`;

/**
 * Flow:
 * 1. First request → server returns 402 with a human-proof challenge in extensions.
 * 2. x402Client picks up the 402, calls enrichPaymentPayload on registered extensions.
 * 3. The human-proof extension signs the challenge and injects the proof into
 *    paymentPayload.extensions["human-proof"] inside the X-PAYMENT header.
 * 4. Server decodes the X-PAYMENT header in onBeforeVerify, finds the proof,
 *    verifies it → validates the client holds required attestations.
 * 5. If client holds required attestations → selects discounted pricing via selector.
 */
async function main(): Promise<void> {
  const evmSigner = privateKeyToAccount(evmPrivateKey);

  const did = buildDIDFromAddress(evmSigner.address)
  const { selector, refresh, disqualify } = createAttestationAwareSelector(did)
  await refresh() // pre-populate cache so the selector has attestations on first use

  const x402 = new x402Client(selector);
  x402.register("eip155:*", new ExactEvmScheme(evmSigner));

  // Re-check after each payment so newly acquired attestations are picked up next time
  x402.onBeforePaymentCreation(async () => { await refresh() });

  x402.registerExtension(createHumanProofExtension({
    address: evmSigner.address,
    signMessage: (msg: string) => evmSigner.signMessage({ message: msg }),
  }));

  x402.onPaymentCreationFailure(async ({ error }) => {
    if (error instanceof MissingAttestationsError) {
      console.error("You need to complete these attestations:", error.attestationRequirements);
    }
  });

  const api = wrapAxiosWithPayment(axios.create(), x402);

  console.log(`Making request to: ${url}\n`);
  let response;
  try {
    response = await api.get(url);
  } catch (err) {
    if (isMaxUseExceededError(err)) {
      disqualify();
      response = await api.get(url);
    } else {
      throw err;
    }
  }
  console.log("Response body:", response.data);

  const paymentResponse = new x402HTTPClient(x402).getPaymentSettleResponse(
    (name) => response.headers[name.toLowerCase()],
  );
  console.log("\nPayment response:", paymentResponse);
}

main().catch((error) => {
  console.error("Error in main execution:", error);
  process.exit(1);
});
