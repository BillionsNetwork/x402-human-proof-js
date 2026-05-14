export type SignatureType = 'eip191' | 'ed25519'

export const DEFAULT_AGENT_OWNERSHIP_SCHEMA = '0xca354bee6dc5eded165461d15ccb13aceb6f77ebbb1fd3fe45aca686097f2911'

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

export const DEFAULT_ATTESTATIONS_API_BASE_URL = 'https://attestations-api.billions.network/api/v1/attestations'

/**
 * Returns true if the given DID has at least one attestation matching the schemaId.
 */
export async function checkAttestation(
  did: string,
  schemaId: string,
  options?: { attestationsApiBaseUrl?: string },
): Promise<boolean> {
  const url = new URL(options?.attestationsApiBaseUrl || DEFAULT_ATTESTATIONS_API_BASE_URL)
  url.searchParams.set('schemaId', schemaId)
  url.searchParams.set('recipientDid', did)

  const response = await fetch(url.toString())
  if (!response.ok) return false

  const json = (await response.json()) as { data?: unknown[] }
  return Array.isArray(json.data) && json.data.length > 0
}

export type HumanProofExtension = {
  info: HumanProofExtensionInfo
  supportedChains: SupportedChain[]
  schema?: unknown
}

function formatResources(resources?: string[]): string {
  if (!resources?.length) return ''
  const lines = resources.map(resource => `- ${resource}`).join('\n')
  return `\nResources:\n${lines}`
}

export function formatSIWEMessage(
  info: HumanProofExtensionInfo & { chainId: string; type: SignatureType },
  address: string,
): string {
  const statementBlock = info.statement ? `\n${info.statement}\n` : '\n'
  const expirationLine = info.expirationTime ? `\nExpiration Time: ${info.expirationTime}` : ''

  return (
    `${info.domain} wants you to sign in with your Ethereum account:\n` +
    `${address}${statementBlock}\n` +
    `URI: ${info.uri ?? ''}\n` +
    `Version: ${info.version}\n` +
    `Chain ID: ${info.chainId}\n` +
    `Nonce: ${info.nonce}\n` +
    `Issued At: ${info.issuedAt}` +
    `${expirationLine}` +
    `${formatResources(info.resources)}`
  )
}
