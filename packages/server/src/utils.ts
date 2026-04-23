import { recoverPublicKey, hashMessage, recoverMessageAddress } from 'viem'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import type { PaywallProvider } from '@x402/core/server'
import type { PaymentRequired } from '@x402/core/types'

export type SignatureType = 'eip191' | 'ed25519'

export type SupportedChain = {
  chainId: string
  type: SignatureType
}

export type HumanProofExtensionInfo = {
  domain: string
  uri?: string
  version: string
  nonce: string
  issuedAt: string
  expirationTime?: string
  statement?: string
  resources?: string[]
  requiredAttestations: string[]
}

export type HumanProofExtensionPayload = HumanProofExtensionInfo & {
  chainId: string
  type: SignatureType
  address: string
  signature: string
}

type ValidationResult = {
  valid: boolean
  error?: string
}

type SignatureVerificationResult = {
  valid: boolean
  address?: string
  pubKey?: string
  error?: string
}

function formatResources(resources?: string[]): string {
  if (!resources?.length) return ''
  const lines = resources.map(resource => `- ${resource}`).join('\n')
  return `\nResources:\n${lines}`
}

function formatSIWEMessage(payload: HumanProofExtensionPayload): string {
  const statementBlock = payload.statement ? `\n${payload.statement}\n` : '\n'
  const expirationLine = payload.expirationTime ? `\nExpiration Time: ${payload.expirationTime}` : ''

  return (
    `${payload.domain} wants you to sign in with your Ethereum account:\n` +
    `${payload.address}${statementBlock}\n` +
    `URI: ${payload.uri ?? ''}\n` +
    `Version: ${payload.version}\n` +
    `Chain ID: ${payload.chainId}\n` +
    `Nonce: ${payload.nonce}\n` +
    `Issued At: ${payload.issuedAt}` +
    `${expirationLine}` +
    `${formatResources(payload.resources)}`
  )
}

function formatSIWSMessage(payload: HumanProofExtensionPayload): string {
  const statementBlock = payload.statement ? `\n${payload.statement}\n` : '\n'
  const expirationLine = payload.expirationTime ? `\nExpiration Time: ${payload.expirationTime}` : ''

  return (
    `${payload.domain} wants you to sign in with your Solana account:\n` +
    `${payload.address}${statementBlock}\n` +
    `URI: ${payload.uri ?? ''}\n` +
    `Version: ${payload.version}\n` +
    `Chain ID: ${payload.chainId}\n` +
    `Nonce: ${payload.nonce}\n` +
    `Issued At: ${payload.issuedAt}` +
    `${expirationLine}` +
    `${formatResources(payload.resources)}`
  )
}

function decodeBase58(input: string): Uint8Array {
  return bs58.decode(input)
}

export function buildHumanProofSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['domain', 'version', 'nonce', 'issuedAt', 'chainId', 'type', 'address', 'signature', 'requiredAttestations'],
    properties: {
      domain: { type: 'string' },
      uri: { type: 'string' },
      version: { type: 'string' },
      nonce: { type: 'string' },
      issuedAt: { type: 'string' },
      expirationTime: { type: 'string' },
      statement: { type: 'string' },
      resources: { type: 'array', items: { type: 'string' } },
      chainId: { type: 'string' },
      type: { enum: ['eip191', 'ed25519'] },
      address: { type: 'string' },
      signature: { type: 'string' },
      requiredAttestations: { type: 'array', items: { type: 'string' }},
    },
    additionalProperties: true,
  }
}

export function parseHumanProofHeader(headerValue: string): HumanProofExtensionPayload {
  const parsed = JSON.parse(headerValue) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid header payload')
  }

  const payload = parsed as Partial<HumanProofExtensionPayload>
  if (!payload.address || !payload.signature || !payload.chainId || !payload.type) {
    throw new Error('Missing required fields in header payload')
  }

  return payload as HumanProofExtensionPayload
}

export async function validateHumanProofMessage(
  payload: HumanProofExtensionPayload,
  resource: string,
): Promise<ValidationResult> {
  if (!payload.domain || !payload.version || !payload.nonce || !payload.issuedAt) {
    return { valid: false, error: 'invalid_message' }
  }

  if (!payload.uri || payload.uri !== resource) {
    return { valid: false, error: 'resource_mismatch' }
  }

  const issuedAtMillis = Date.parse(payload.issuedAt)
  if (Number.isNaN(issuedAtMillis)) {
    return { valid: false, error: 'invalid_issued_at' }
  }

  if (payload.expirationTime) {
    const expirationMillis = Date.parse(payload.expirationTime)
    if (Number.isNaN(expirationMillis)) {
      return { valid: false, error: 'invalid_expiration_time' }
    }
    if (expirationMillis < Date.now()) {
      return { valid: false, error: 'message_expired' }
    }
  }

  return { valid: true }
}

export async function verifyHumanProofSignature(
  payload: HumanProofExtensionPayload,
): Promise<SignatureVerificationResult> {
  if (payload.type === 'eip191') {
    if (!payload.signature.startsWith('0x')) {
      return { valid: false, error: 'invalid_signature' }
    }
    try {
      const message = formatSIWEMessage(payload)
      const signature = payload.signature as `0x${string}`

      const recovered = await recoverMessageAddress({ message, signature })
      if (recovered.toLowerCase() !== payload.address.toLowerCase()) {
        return { valid: false, error: 'invalid_signature' }
      }

      const publicKey = await recoverPublicKey({ hash: hashMessage(message), signature })
      return { valid: true, address: payload.address, pubKey: publicKey }
    } catch {
      return { valid: false, error: 'invalid_signature' }
    }
  }

  if (payload.type === 'ed25519') {
    try {
      const message = new TextEncoder().encode(formatSIWSMessage(payload))
      const publicKey = decodeBase58(payload.address)
      const signature = decodeBase58(payload.signature)

      const valid = nacl.sign.detached.verify(message, signature, publicKey)
      if (!valid) return { valid: false, error: 'invalid_signature' }
      return { valid: true, address: payload.address, pubKey: bs58.encode(publicKey) }
    } catch {
      return { valid: false, error: 'invalid_signature' }
    }
  }

  return { valid: false, error: 'invalid_signature_type' }
}

const DEFAULT_PAYWALL_HTML =
  "<html><body>" +
  "<h1>Payment Required</h1>" +
  "<p>Please complete the payment to access this resource.</p>" +
  "<p>The payment depends on verified-agent-identity plugin. " +
  "That can be downloaded from: " +
  '<a href="https://clawhub.ai/obrezhniev/verified-agent-identity">clawhub.ai</a> ' +
  '<a href="https://skills.sh/billionsnetwork/verified-agent-identity/verified-agent-identity">skills.sh</a>' +
  "</p></body></html>"

export function paywallInstructions(html?: string): PaywallProvider {
  return new (class implements PaywallProvider {
    public generateHtml(_: PaymentRequired): string {
      return html ?? DEFAULT_PAYWALL_HTML
    }
  })()
}
