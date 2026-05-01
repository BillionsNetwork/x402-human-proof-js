export type HumanResolution = {
  humanId: string
  verifiedAt: string       // ISO 8601
  attestationId: string
}

export type DeclareHumanProofOptions = {
  statement?: string
  resourceUri?: string
  domain?: string
  version?: string
  expirationSeconds?: number
  network?: string | string[]
}

export type HumanProofDeclaration = {
  _options: DeclareHumanProofOptions
  _type: 'human-proof'
}

export type HumanVerifiedEvent = {
  type: 'human_verified'
  resource: string
  did: string
  address: string
  humanId: string
  verifiedAt: string
  attestationId: string
}

export type HumanNotRegisteredEvent = {
  type: 'human_not_registered'
  resource: string
  did: string
}

export type MaxUseExceededEvent = {
  type: 'max_use_exceeded'
  resource: string
  humanId: string
  maxUse: number
}

export type HumanProofEvent = HumanVerifiedEvent | HumanNotRegisteredEvent | MaxUseExceededEvent


export type PoUVerifierOptions = {
  /**
   * Optional override for the attestation check implementation.
   * If not provided, queries the Billions Network explorer API.
   * For full customisation (including human lookup), implement the PoUVerifier
   * interface directly and pass it via CreateVerifyHumanProofHookOptions.verifier.
   */
  hasAttestation?: (did: string, chainId: string, schema: string) => Promise<boolean>
  /** Override the attestations API base URL. Defaults to the Billions Network explorer. */
  attestationsApiBaseUrl?: string
  /** Override the agent-ownership schema ID used for human registry lookups. */
  agentOwnershipSchema?: string
  /** Override the nullifier API base URL. Defaults to the Billions Network nullifier endpoint. */
  nullifierApiBaseUrl?: string
}

export interface HumanUsageStorage {
  /**
   * Atomically increments the usage count for (humanId, scope) only if the
   * current count is strictly below maxUse, and returns the new count.
   * Returns null if the limit was already reached (no increment is performed).
   *
   * `scope` isolates counters per resource so that a limit on one route does
   * not consume quota for another. Typically the resource URL, but callers may
   * supply any stable key (e.g. a route ID or accept-option identifier).
   *
   * Implementations must be a single atomic operation so concurrent requests
   * cannot both pass the limit check:
   *   - Redis: Lua script (GET + conditional INCR), key = `${humanId}:${scope}`
   *   - SQL:   UPDATE human_usage SET count = count + 1 WHERE human_id = ? AND scope = ? AND count < ? RETURNING count
   */
  incrementIfBelow(humanId: string, maxUse: number, scope: string): Promise<number | null>

  /**
   * Decrements usage for (humanId, scope) if current value is above zero.
   * Returns the new count, or null if no decrement was performed.
   */
  decrementIfAboveZero(humanId: string, scope: string): Promise<number | null>
}

export interface PoUVerifier {
  /**
   * The schema ID used to determine human registration (checked by lookupHuman).
   * Used by hooks to skip redundant hasAttestation calls for this schema.
   */
  ownershipSchema: string
  /**
   * Resolve an agent DID to its verified human record.
   * Returns null if the DID is not registered in the PoU registry.
   */
  lookupHuman(did: string, chainId: string): Promise<HumanResolution | null>
  /**
   * Check whether a DID holds a specific attestation schema.
   * Returns true if the attestation exists, false otherwise.
   */
  hasAttestation?(did: string, chainId: string, schema: string): Promise<boolean>
}