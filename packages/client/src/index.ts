import type { PaymentRequirements } from '@x402/core/types'
import { decodePaymentRequiredHeader } from '@x402/core/http'
import { Blockchain, buildDIDType, DidMethod, NetworkId } from '@iden3/js-iden3-core'
import { buildDIDFromEthAddress } from '@0xpolygonid/js-sdk'
import {
  formatSIWEMessage,
  checkAttestation,
  DEFAULT_AGENT_OWNERSHIP_SCHEMA,
} from './utils.js'
import type {
  HumanProofExtension,
  HumanProofExtensionInfo,
  SignatureType,
} from './utils.js'

export function buildDIDFromAddress(ethAddress: string): string {
  const didType = buildDIDType(DidMethod.Iden3!, Blockchain.Billions!, NetworkId.Main!)
  return buildDIDFromEthAddress(didType, ethAddress).string()
}

export type { HumanProofExtension as HumanProofChallenge }

export type AttestationRequirement = {
  schemaId: string
}

export { checkAttestation, DEFAULT_ATTESTATIONS_API_BASE_URL, DEFAULT_AGENT_OWNERSHIP_SCHEMA } from './utils.js'

export class MissingAttestationsError extends Error {
  readonly attestationRequirements: AttestationRequirement[] | undefined
  constructor(attestationRequirements?: AttestationRequirement[]) {
    const missingSchemaIds = (attestationRequirements ?? []).map(a => a.schemaId).join(', ')
    super(`Missing required attestations: ${missingSchemaIds || '(none specified)'}`)
    this.name = 'MissingAttestationsError'
    this.attestationRequirements = attestationRequirements
  }
}

// ---------------------------------------------------------------------------
// EVM signer interface (EOA — smart wallet support post-MVP)
// ---------------------------------------------------------------------------

/**
 * Minimal EVM signing interface. Compatible with viem WalletClient,
 * ethers Signer, or any custom implementation.
 *
 * @example viem
 * const evmSigner: EVMSigner = {
 *   address: walletClient.account.address,
 *   signMessage: (msg) => walletClient.signMessage({ message: msg }),
 * }
 *
 * @example ethers
 * const evmSigner: EVMSigner = {
 *   address: await signer.getAddress(),
 *   signMessage: (msg) => signer.signMessage(msg),
 * }
 */
export type EVMSigner = {
  address: string
  signMessage(message: string): Promise<string>
}

// ---------------------------------------------------------------------------
// signHumanProofChallenge — EVM (SIWE / eip191)
// ---------------------------------------------------------------------------

/**
 * Sign a human-proof challenge for an EVM agent wallet (EOA).
 *
 * Constructs the SIWE message from the challenge, signs it, and returns
 * the JSON string to be sent as the HUMAN-PROOF request header.
 *
 * @param challenge   The `extensions["human-proof"]` object from the 402 response
 * @param signer      An EVM signing interface
 * @param chainId     CAIP-2 chain ID to use (e.g. "eip155:137"). Must be in challenge.supportedChains.
 */
export async function signHumanProofChallengeEVM(
  challenge: HumanProofExtension,
  signer: EVMSigner,
  chainId: string,
): Promise<string> {
  const chain = challenge.supportedChains.find(
    c => c.chainId === chainId && (c.type === 'eip191'),
  )
  if (!chain) {
    throw new Error(
      `No supported EVM chain found for chainId "${chainId}". ` +
      `Supported: ${challenge.supportedChains.map(c => c.chainId).join(', ')}`,
    )
  }

  const completeInfo: HumanProofExtensionInfo & { chainId: string; type: SignatureType } = {
    ...challenge.info,
    chainId,
    type: chain.type,
  }

  const message = formatSIWEMessage(completeInfo, signer.address)
  const signature = await signer.signMessage(message)

  return JSON.stringify({
    ...completeInfo,
    address: signer.address,
    signature,
  })
}

// ---------------------------------------------------------------------------
// createHumanProofExtension — ready-to-register x402 client extension
// ---------------------------------------------------------------------------

export type HumanProofExtensionOptions = {
  /** Override the attestations API base URL. Defaults to the Billions Network explorer. */
  attestationsApiBaseUrl?: string
}

/**
 * Creates a human-proof client extension object for use with x402Client.registerExtension().
 *
 * Handles challenge extraction, chain selection, and signing automatically.
 * Provide an EVMSigner implementation to enable signing for EVM-based agent wallets.
 *
 * @example
 * import { createHumanProofExtension } from '@polygonid/x402-human-proof-client'
 * x402.registerExtension(createHumanProofExtension(evmSigner))
 */
export function createHumanProofExtension(signer: EVMSigner, options?: HumanProofExtensionOptions) {
  return {
    key: 'human-proof' as const,
    enrichPaymentPayload: async <T extends { extensions?: Record<string, unknown> }>(
      paymentPayload: T,
      paymentRequired: { extensions?: Record<string, unknown> },
    ): Promise<T> => {
      const challenge = extractHumanProofChallenge(paymentRequired ?? {})
      if (!challenge) return paymentPayload

      const did = buildDIDFromAddress(signer.address)
      const requiredAttestations = challenge.info.requiredAttestations
      const checkOpts = options?.attestationsApiBaseUrl
        ? { attestationsApiBaseUrl: options.attestationsApiBaseUrl }
        : undefined
      const missingAttestations = (
        await Promise.all(
          requiredAttestations.map(async schemaId =>
            (await checkAttestation(did, schemaId, checkOpts)) ? null : schemaId,
          ),
        )
      ).filter((s): s is string => s !== null)

      if (missingAttestations.length) {
        throw new MissingAttestationsError(
          missingAttestations.map(schemaId => ({ schemaId }))
        )
      }

      const evmChain = challenge.supportedChains.find(
        c => c.type === 'eip191',
      )
      if (!evmChain) {
        throw new Error(
          `No supported EVM chain found in challenge. ` +
          `Supported chains: ${challenge.supportedChains.map(c => `${c.chainId} (${c.type})`).join(', ')}.`,
        )
      }
      const signedProof = await signHumanProofChallengeEVM(challenge, signer, evmChain.chainId)
      const proofObj = JSON.parse(signedProof) as Record<string, unknown>
      const enrichedProof = JSON.stringify({ ...proofObj, requiredAttestations })

      return {
        ...paymentPayload,
        extensions: {
          ...paymentPayload.extensions,
          'human-proof': enrichedProof,
        },
      } as T
    },
  }
}

// ---------------------------------------------------------------------------
// Convenience: parse a 402 response and extract the human-proof challenge
// ---------------------------------------------------------------------------

/**
 * Extract the human-proof challenge from a 402 PaymentRequired response body.
 * Returns null if the response does not include a human-proof extension.
 */
export function extractHumanProofChallenge(
  paymentRequired: { extensions?: Record<string, unknown> },
): HumanProofExtension | null {
  const ext = paymentRequired.extensions?.['human-proof']
  if (!ext || typeof ext !== 'object') return null
  return ext as HumanProofExtension
}

export function isMaxUseExceededError(err: unknown): boolean {
  if (!hasHttpResponse(err)) return false
  const status = err.response?.status ?? err.response?.statusCode
  if (status !== 402) return false
  const raw = getHeader(err.response?.headers, 'payment-required')
  if (!raw) return false
  try {
    return decodePaymentRequiredHeader(raw).error === 'max_use_exceeded'
  } catch {
    return false
  }
}

type HttpHeaders = Record<string, unknown> | { get(name: string): string | null }

function hasHttpResponse(err: unknown): err is {
  response?: { status?: number; statusCode?: number; headers?: HttpHeaders }
} {
  return typeof err === 'object' && err !== null && 'response' in err
}

function getHeader(headers: HttpHeaders | undefined, name: string): string | undefined {
  if (!headers) return undefined
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const val = (headers as { get(name: string): string | null }).get(name)
    return val ?? undefined
  }
  const rec = headers as Record<string, unknown>
  const lower = name.toLowerCase()
  for (const key of Object.keys(rec)) {
    if (key.toLowerCase() === lower) {
      const val = rec[key]
      if (typeof val === 'string') return val
      if (Array.isArray(val)) return val[0] != null ? String(val[0]) : undefined
      if (val != null) return String(val)
    }
  }
  return undefined
}

export type AttestationAwareSelector = {
  /** Synchronous selector to pass to `new x402Client(selector)`. */
  selector: (_version: number, requirements: PaymentRequirements[]) => PaymentRequirements
  /**
   * Re-fetches held attestations from the registry.
   * Call this inside `x402.onBeforePaymentCreation` so attestations are
   * always up-to-date (e.g. after the user completes a registration flow).
   */
  refresh: () => Promise<void>
  /**
   * Permanently forces the selector to skip discounted options for all
   * subsequent payments on this selector instance. Call this when the server
   * returns a max_use_exceeded error so every retry uses the full-price accept.
   * The flag is NOT reset by refresh() — create a new selector to re-enable
   * discounted selection.
   */
  disqualify: () => void
}

/**
 * Creates a selector + refresh + disqualify triple for x402Client that picks
 * the discounted `accepts` option when the client holds the required attestations.
 *
 * Attestations are cached internally and re-fetched on every call to `refresh()`.
 * Call `disqualify()` when the server returns a `max_use_exceeded` error to
 * permanently fall back to full-price for all subsequent payments on this
 * selector instance. The flag is NOT reset by refresh().
 *
 * @param did      The client's DID (use buildDIDFromAddress(ethAddress))
 * @param schemas  Schema IDs to check (defaults to DEFAULT_AGENT_OWNERSHIP_SCHEMA)
 *
 * @example
 * const { selector, refresh, disqualify } = createAttestationAwareSelector(did)
 * const x402 = new x402Client(selector)
 * x402.onBeforePaymentCreation(async () => { await refresh() })
 */
export function createAttestationAwareSelector(
  did: string,
  schemas: string[] = [DEFAULT_AGENT_OWNERSHIP_SCHEMA],
  options?: { attestationsApiBaseUrl?: string },
): AttestationAwareSelector {
  let held = new Set<string>()
  let disqualified = false

  const refresh = async (): Promise<void> => {
    const checkOpts = options?.attestationsApiBaseUrl ? { attestationsApiBaseUrl: options.attestationsApiBaseUrl } : undefined
    const results = await Promise.all(
      schemas.map(async s => (await checkAttestation(did, s, checkOpts) ? s : null))
    )
    held = new Set(results.filter((s): s is string => s !== null))
  }

  const disqualify = (): void => { disqualified = true }

  const selector = (_version: number, requirements: PaymentRequirements[]): PaymentRequirements => {
    if (!disqualified) {
      for (const req of requirements) {
        const needed = req.extra?.requiredAttestations as string[] | undefined
        if (!needed?.length) continue
        if (needed.every(s => held.has(s))) return req
      }
    }

    // Discounted option skipped — fall back to first option without attestation requirement
    return requirements.find(r => !(r.extra?.requiredAttestations as string[] | undefined)?.length)
      ?? requirements[0]!
  }

  return { selector, refresh, disqualify }
}
