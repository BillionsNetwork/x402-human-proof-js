export {
  createHumanProofExtension,
  createVerifyHumanProofHook,
  configureHumanProofServer,
} from './server.js'
export type {
  CreateHumanProofExtensionOptions,
  CreateVerifyHumanProofHookOptions,
  ConfigureHumanProofServerOptions,
} from './server.js'

export { HUMAN_PROOF, declareHumanProofExtension, getSignatureTypes } from './declare.js'

export {
  createPoUVerifier,
  DEFAULT_AGENT_OWNERSHIP_SCHEMA,
  DEFAULT_ATTESTATIONS_API_BASE_URL,
} from './verifier.js'

export { verifyHumanProofRequest, HUMAN_PROOF_HEADER } from './hooks.js'
export type { HumanProofRequestContext, HumanProofRequestResult } from './hooks.js'

export type {
  HumanResolution,
  DeclareHumanProofOptions,
  HumanProofDeclaration,
  HumanVerifiedEvent,
  HumanNotRegisteredEvent,
  MaxUseExceededEvent,
  HumanProofEvent,
  PoUVerifierOptions,
  PoUVerifier,
  HumanUsageStorage,
} from './types.js'

export { paywallInstructions } from './utils.js'
