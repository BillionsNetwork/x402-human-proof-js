import { buildHumanProofSchema } from './utils.js'
import { randomBytes } from 'crypto'
import { HUMAN_PROOF, getSignatureTypes } from './declare.js'
import { verifyHumanProofRequest } from './hooks.js'
import type { HumanProofDeclaration, HumanProofEvent, HumanUsageStorage, PoUVerifier, PoUVerifierOptions } from './types.js'
import type { ResourceServerExtension, PaymentRequiredContext } from '@x402/core/types'
import type { HumanProofExtensionInfo, SupportedChain } from './utils.js'
import { createPoUVerifier, DEFAULT_AGENT_OWNERSHIP_SCHEMA } from './verifier.js'
import type { x402ResourceServer } from '@x402/core/server'

export type CreateHumanProofExtensionOptions = {
  /** Must match the agentOwnershipSchema configured in your PoUVerifier, if customised. */
  agentOwnershipSchema?: string
}

export function createHumanProofExtension(options: CreateHumanProofExtensionOptions = {}): ResourceServerExtension {
  const ownershipSchema = options.agentOwnershipSchema ?? DEFAULT_AGENT_OWNERSHIP_SCHEMA
  return {
    key: HUMAN_PROOF,
    enrichPaymentRequiredResponse: async (
      declaration: unknown,
      context: PaymentRequiredContext,
    ): Promise<unknown> => {
      const decl = declaration as HumanProofDeclaration
      const opts = decl._options ?? {}

      const resourceUri = opts.resourceUri ?? context.resourceInfo.url

      let domain = opts.domain
      if (!domain) {
        try {
          domain = new URL(resourceUri).hostname
        } catch {
          throw new Error(
            `Cannot derive domain from resourceUri "${resourceUri}". ` +
            `Set opts.domain explicitly in declareHumanProofExtension.`,
          )
        }
      }

      let networks: string[]
      if (opts.network) {
        networks = Array.isArray(opts.network) ? opts.network : [opts.network]
      } else {
        networks = [...new Set(context.requirements.map(r => r.network))]
      }

      const nonce = randomBytes(16).toString('hex')
      const issuedAt = new Date().toISOString()

      const expirationSeconds = opts.expirationSeconds
      const expirationTime =
        expirationSeconds !== undefined
          ? new Date(Date.now() + expirationSeconds * 1000).toISOString()
          : undefined

      const requiredAttestations: string[] = [ownershipSchema]

      const info: HumanProofExtensionInfo = {
        domain,
        uri: resourceUri,
        version: opts.version ?? '1',
        nonce,
        issuedAt,
        requiredAttestations,
      }

      if (resourceUri) info.resources = [resourceUri]
      if (expirationTime) info.expirationTime = expirationTime
      if (opts.statement) info.statement = opts.statement

      // Only eip155 networks support the CAIP-122 signing flow; Solana routes still
      // accept payment but are not listed as human-proof signing options.
      const supportedChains: SupportedChain[] = networks
        .filter(network => network.startsWith('eip155:'))
        .flatMap(network => getSignatureTypes(network).map(type => ({ chainId: network, type })))

      const result: Record<string, unknown> = {
        info,
        supportedChains,
        schema: buildHumanProofSchema(),
      }
      return result
    },
  }
}

export type CreateVerifyHumanProofHookOptions = {
  verifier?: PoUVerifier
  verifierOptions?: PoUVerifierOptions
  onEvent?: (event: HumanProofEvent) => void | Promise<void>
  storage?: HumanUsageStorage
}

export function createVerifyHumanProofHook(
  options: CreateVerifyHumanProofHookOptions = {},
) {
  const { onEvent, storage } = options
  const verifier = options.verifier ?? createPoUVerifier(options.verifierOptions ?? {})

  return async (context: {
    paymentPayload: { extensions?: Record<string, unknown>; resource?: { url: string } }
    requirements?: { extra?: Record<string, unknown> }
  }): Promise<void | { abort: true; reason: string }> => {
    const humanProofHeader = context.paymentPayload.extensions?.[HUMAN_PROOF] as string | undefined
    const resource = context.paymentPayload.resource?.url ?? ''


    // if no extra attestation requirements are specified, we can skip the human proof verification
    const requiredAttestations = context.requirements?.extra?.requiredAttestations as string[] | undefined
    if (!requiredAttestations?.length) {
      return
    }
    const result = await verifyHumanProofRequest(verifier, {
      resource,
      humanProofHeader: humanProofHeader ?? null,
      ...(onEvent ? { onEvent } : {}),
    })

    if (!result.allowed) {
      return { abort: true, reason: result.reason }
    }

    const extraSchemas = requiredAttestations?.filter(s => s !== verifier.ownershipSchema)
    if (extraSchemas?.length) {
      if (!verifier.hasAttestation) {
        return { abort: true, reason: 'verifier_cannot_check_attestations' }
      }
      for (const schema of extraSchemas) {
        const has = await verifier.hasAttestation(result.did, result.chainId, schema)
        if (!has) {
          return { abort: true, reason: 'missing_required_attestation' }
        }
      }
    }

    const maxUseRaw = context.requirements?.extra?.maxUse
    if (maxUseRaw === undefined) return
    if (typeof maxUseRaw !== 'number' || !Number.isFinite(maxUseRaw) || !Number.isInteger(maxUseRaw) || maxUseRaw < 1) {
      return { abort: true, reason: 'invalid_max_use_value' }
    }
    const maxUse = maxUseRaw
    if (!storage) {
      return { abort: true, reason: 'misconfigured_max_use_storage' }
    }
    const scopeRaw = context.requirements?.extra?.scope
    const scope = typeof scopeRaw === 'string' && scopeRaw ? scopeRaw : resource
    const count = await storage.incrementIfBelow(result.resolution.humanId, maxUse, scope)
    if (count === null) {
      await onEvent?.({ type: 'max_use_exceeded', resource, humanId: result.resolution.humanId, maxUse })
      return { abort: true, reason: 'max_use_exceeded' }
    }
  }
}

async function resolveUsageContext(
  context: {
    paymentPayload: { extensions?: Record<string, unknown>; resource?: { url: string } }
    requirements?: { extra?: Record<string, unknown> }
  },
  verifier: PoUVerifier,
): Promise<{ humanId: string; scope: string } | null> {
  const requiredAttestations = context.requirements?.extra?.requiredAttestations as string[] | undefined
  if (!requiredAttestations?.length) return null

  const maxUseRaw = context.requirements?.extra?.maxUse
  if (typeof maxUseRaw !== 'number' || !Number.isFinite(maxUseRaw) || !Number.isInteger(maxUseRaw) || maxUseRaw < 1) {
    return null
  }

  const humanProofHeader = context.paymentPayload.extensions?.[HUMAN_PROOF] as string | undefined
  const resource = context.paymentPayload.resource?.url ?? ''

  const result = await verifyHumanProofRequest(verifier, {
    resource,
    humanProofHeader: humanProofHeader ?? null,
  })
  if (!result.allowed) return null

  const scopeRaw = context.requirements?.extra?.scope
  const scope = typeof scopeRaw === 'string' && scopeRaw ? scopeRaw : resource
  return { humanId: result.resolution.humanId, scope }
}

export type CreateAfterVerifyFailureRollbackHookOptions = {
  storage: HumanUsageStorage
  verifier: PoUVerifier
}

export function createAfterVerifyFailureRollbackHook(
  options: CreateAfterVerifyFailureRollbackHookOptions,
) {
  const { storage, verifier } = options

  return async (context: {
    paymentPayload: { extensions?: Record<string, unknown>; resource?: { url: string } }
    requirements?: { extra?: Record<string, unknown> }
    result: { isValid?: boolean }
  }): Promise<void> => {
    if (context.result.isValid !== false) return
    const resolved = await resolveUsageContext(context, verifier)
    if (!resolved) return
    await storage.decrementIfAboveZero(resolved.humanId, resolved.scope)
  }
}

export type CreateVerifyFailureRollbackHookOptions = {
  storage: HumanUsageStorage
  verifier: PoUVerifier
}

export function createVerifyFailureRollbackHook(
  options: CreateVerifyFailureRollbackHookOptions,
) {
  const { storage, verifier } = options

  return async (context: {
    paymentPayload: { extensions?: Record<string, unknown>; resource?: { url: string } }
    requirements?: { extra?: Record<string, unknown> }
    error?: Error
  }): Promise<void> => {
    const resolved = await resolveUsageContext(context, verifier)
    if (!resolved) return
    await storage.decrementIfAboveZero(resolved.humanId, resolved.scope)
  }
}

export type CreateSettleFailureRollbackHookOptions = {
  storage: HumanUsageStorage
  verifier: PoUVerifier
}

export function createSettleFailureRollbackHook(
  options: CreateSettleFailureRollbackHookOptions,
) {
  const { storage, verifier } = options

  return async (context: {
    paymentPayload: { extensions?: Record<string, unknown>; resource?: { url: string } }
    requirements?: { extra?: Record<string, unknown> }
    error?: Error
  }): Promise<void> => {
    const resolved = await resolveUsageContext(context, verifier)
    if (!resolved) return
    await storage.decrementIfAboveZero(resolved.humanId, resolved.scope)
  }
}

export type ConfigureHumanProofServerOptions = {
  extensionOptions?: CreateHumanProofExtensionOptions
  verifier?: PoUVerifier
  verifierOptions?: PoUVerifierOptions
  onEvent?: (event: HumanProofEvent) => void | Promise<void>
  storage?: HumanUsageStorage
}

export function configureHumanProofServer(
  server: x402ResourceServer,
  options: ConfigureHumanProofServerOptions = {},
): void {
  const {
    extensionOptions,
    verifier,
    verifierOptions,
    onEvent,
    storage,
  } = options

  const resolvedVerifier = verifier ?? createPoUVerifier(verifierOptions ?? {})

  server.registerExtension(createHumanProofExtension(extensionOptions))
  server.onBeforeVerify(createVerifyHumanProofHook({
    verifier: resolvedVerifier,
    ...(onEvent ? { onEvent } : {}),
    ...(storage ? { storage } : {}),
  }))

  if (storage) {
    server.onAfterVerify(createAfterVerifyFailureRollbackHook({ storage, verifier: resolvedVerifier }))
    server.onVerifyFailure(createVerifyFailureRollbackHook({ storage, verifier: resolvedVerifier }))
    server.onSettleFailure(createSettleFailureRollbackHook({ storage, verifier: resolvedVerifier }))
  }
}
