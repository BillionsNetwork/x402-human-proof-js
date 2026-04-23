import {
  parseHumanProofHeader,
  validateHumanProofMessage,
  verifyHumanProofSignature,
} from './utils.js'
import type { HumanResolution, HumanProofEvent, PoUVerifier } from './types.js'
import { Blockchain, buildDIDType, DidMethod, NetworkId } from '@iden3/js-iden3-core'
import { buildDIDFromEthAddress } from '@0xpolygonid/js-sdk'

export const HUMAN_PROOF_HEADER = 'HUMAN-PROOF'

export type HumanProofRequestContext = {
  /** The resource URI being accessed (used to validate the CAIP-122 message). */
  resource: string
  /** Value of the HUMAN-PROOF request header, or null if absent. */
  humanProofHeader: string | null
  /** Optional callback fired on human_verified and human_not_registered events. */
  onEvent?: (event: HumanProofEvent) => void | Promise<void>
}

export type HumanProofRequestResult =
  | { allowed: true; resolution: HumanResolution; did: string; chainId: string }
  | {
      allowed: false
      reason:
        | 'missing_header'
        | 'invalid_header'
        | 'invalid_message'
        | 'invalid_signature'
        | 'not_registered'
        | string
      did?: string
      humanId?: string
    }

/**
 * Verify a HUMAN-PROOF request header against the PoU registry.
 *
 * Call this inside a request hook (BeforeVerifyHook or framework middleware)
 * to gate access based on human verification.
 *
 * Flow:
 *  1. Parse the CAIP-122 signed payload from the HUMAN-PROOF header
 *  2. Validate message fields (resource URI, nonce expiry)
 *  3. Verify the cryptographic signature (EVM eip191 or Solana ed25519)
 *  4. Resolve the wallet address to a HumanResolution via the on-chain registry
 *  5. Fire hook events
 */
export async function verifyHumanProofRequest(
  verifier: PoUVerifier,
  context: HumanProofRequestContext,
): Promise<HumanProofRequestResult> {
  const { resource, humanProofHeader, onEvent } = context

  if (!humanProofHeader) {
    return { allowed: false, reason: 'missing_header' }
  }

  let payload
  try {
    payload = parseHumanProofHeader(humanProofHeader)
  } catch {
    return { allowed: false, reason: 'invalid_header' }
  }

  // Validate CAIP-122 message fields (URI match, nonce, expiry)
  const validation = await validateHumanProofMessage(payload, resource)
  if (!validation.valid) {
    return { allowed: false, reason: validation.error ?? 'invalid_message' }
  }

  // Verify cryptographic signature — handles both eip191 (SIWE) and ed25519 (SIWS)
  const sigResult = await verifyHumanProofSignature(payload)
  if (!sigResult.valid || !sigResult.address) {
    return { allowed: false, reason: sigResult.error ?? 'invalid_signature' }
  }

  const didType = buildDIDType(DidMethod.Iden3!, Blockchain.Billions!, NetworkId.Main!)
  const didString = buildDIDFromEthAddress(didType, sigResult.address!).string()
  // Resolve did → human via resolver
  const resolution = await verifier.lookupHuman(didString, payload.chainId)
  if (!resolution) {
    await onEvent?.({
      type: 'human_not_registered',
      resource,
      did: didString,
    })

    return { allowed: false, reason: 'not_registered', did: didString }
  }

  await onEvent?.({
    type: 'human_verified',
    resource,
    did: didString,
    humanId: resolution.humanId,
    verifiedAt: resolution.verifiedAt,
  })

  return { allowed: true, resolution, did: didString, chainId: payload.chainId }
}
