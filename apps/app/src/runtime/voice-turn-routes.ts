/**
 * The resident agent's end-of-turn and heard routes as the voice assistant uses them (#423),
 * through the owner-bound resident request port (connection-ui getResidentLiveVoice), and the
 * end-of-turn chain over them (local fused scorer, then an optional Clef stage, then the long
 * gap). The implementations are the shared upstream `@elizaos/voice/turn-routes` and
 * `@elizaos/voice/endpoint-chain` clients, authenticated and projected from the reviewed pin.
 * Alpha keeps this module path for its adapter and tests; it adds no behavior of its own.
 */
export {
  createHeardReporter,
  END_OF_TURN_MAX_CHARS,
  END_OF_TURN_PATH,
  heardPath,
  readEndOfTurn,
  residentEndpoint,
  type EndOfTurnUnavailableReason,
  type HeardOutcome,
  type HeardReport,
  type HeardReporterPorts,
  type ResidentRequest,
} from '../../../../.eliza/client-features/packages/voice/src/voice-turn-routes.ts';
export {
  CLEF_ENDPOINT_TIMEOUT_MS,
  clefEndpointStageEnabled,
  createEndpointChain,
  readClefTurn,
  type ClefEndpointStage,
  type ClefEndpointUnavailableReason,
  type ClefTurnClient,
  type EndpointPath,
} from '../../../../.eliza/client-features/packages/voice/src/voice-endpoint-chain.ts';
