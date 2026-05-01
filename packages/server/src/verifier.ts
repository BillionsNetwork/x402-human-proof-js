import type {
  HumanResolution,
  PoUVerifier,
  PoUVerifierOptions,
} from './types.js'

export const DEFAULT_ATTESTATIONS_API_BASE_URL =
  'https://attestations-api.billions.network/api/v1/attestations'

export const DEFAULT_NULLIFIER_API_BASE_URL =
  'https://attestations-api.billions.network/api/v1/nullifier'

export const DEFAULT_AGENT_OWNERSHIP_SCHEMA =
  '0xca354bee6dc5eded165461d15ccb13aceb6f77ebbb1fd3fe45aca686097f2911'

type ExplorerAttestationItem = {
  creationTime: number
  time?: number
  id: string
  schemaId: string
  fromId?: string
  recipientEthereumAddress?: string
  attesterEthereumAddress?: string
  toEthereumAddress?: string
}

type ExplorerAttestationsResponse = {
  data?: ExplorerAttestationItem[]
  nextPage?: number | null
}

async function fetchExplorerPage(
  baseUrl: string,
  schema: string,
  recipientDid: string,
): Promise<ExplorerAttestationsResponse> {
  const url = new URL(baseUrl)

  url.searchParams.set('schemaId', schema)
  url.searchParams.set('recipientDid', recipientDid)

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Attestations explorer lookup failed (${response.status})`)
  }

  const json = (await response.json()) as ExplorerAttestationsResponse
  return json
}

async function fetchNullifier(nullifierBaseUrl: string, userId: string): Promise<string | null> {
  const url = new URL(nullifierBaseUrl)
  url.searchParams.set('userId', userId)

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Nullifier lookup failed (${response.status})`)
  }

  const json = (await response.json()) as { userId: string; nullifier: string }
  return json.nullifier ?? null
}

async function lookupHumanFromExplorer(
  did: string,
  options: {
    baseUrl: string
    schema: string
    nullifierBaseUrl: string
  },
): Promise<HumanResolution | null> {
  const payload = await fetchExplorerPage(
    options.baseUrl,
    options.schema,
    did,
  )

  const sorted = (payload.data ?? []).sort((a, b) => (b.creationTime ?? 0) - (a.creationTime ?? 0))
  const match = sorted[0]

  if (match?.fromId) {
    const nullifier = await fetchNullifier(options.nullifierBaseUrl, match.fromId)
    if (nullifier) {
      return {
        humanId: nullifier,
        verifiedAt: new Date(match.creationTime * 1000).toISOString(),
        attestationId: match.id,
      }
    }
  }

  return null
}

/**
 * Creates a PoU (Proof of Uniqueness) verifier that resolves a DID
 * to a HumanResolution.
 * @example
 * const verifier = createPoUVerifier()
 * const resolution = await verifier.lookupHuman('did:iden3:...', 'eip155:137')
 */
export function createPoUVerifier(options: PoUVerifierOptions = {}): PoUVerifier {
  const baseUrl = options.attestationsApiBaseUrl ?? DEFAULT_ATTESTATIONS_API_BASE_URL
  const nullifierBaseUrl = options.nullifierApiBaseUrl ?? DEFAULT_NULLIFIER_API_BASE_URL
  const ownershipSchema = options.agentOwnershipSchema ?? DEFAULT_AGENT_OWNERSHIP_SCHEMA

  return {
    ownershipSchema,

    async lookupHuman(did: string, _chainId: string): Promise<HumanResolution | null> {
      return lookupHumanFromExplorer(did, { baseUrl, schema: ownershipSchema, nullifierBaseUrl })
    },

    async hasAttestation(did: string, _chainId: string, schema: string): Promise<boolean> {
      if (options.hasAttestation) {
        return options.hasAttestation(did, _chainId, schema)
      }
      const payload = await fetchExplorerPage(baseUrl, schema, did)
      return (payload.data ?? []).length > 0
    },
  }
}
