import type { SignatureType } from './utils.js'
import type { DeclareHumanProofOptions, HumanProofDeclaration } from './types.js'

export const HUMAN_PROOF = 'human-proof'

/**
 *
 * @example
 * extensions: declareHumanProofExtension({
 *   statement: 'Verify your agent is backed by a verified human',
 * })
 */
export function declareHumanProofExtension(options: DeclareHumanProofOptions): HumanProofDeclaration {
  return { _options: options, _type: 'human-proof' }
}

/**
 * Returns the supported signature types for a given CAIP-2 network.
 * Solana uses ed25519 (SIWS); all EVM networks use eip191 (SIWE).
 */
export function getSignatureTypes(network: string): SignatureType[] {
  if (network.startsWith('solana:')) return ['ed25519']
  return ['eip191']
}
