/** Default for new host profiles. Existing profiles retain their reviewed routing. */
export const AGENT_MODEL = modelName(process.env.CEREBRAS_MODEL ?? 'qwen-3.8-27b');
function modelName(value: any) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._:/-]{1,200}$/.test(value)) throw Error('Invalid agent model identifier');
  return value;
}
export function agentModelEnvironment(config: any) {
  const route=config?.serviceRouting?.llmText;
  if (route?.backend !== 'cerebras' || route?.transport !== 'direct') throw Error('Local launcher requires reviewed direct Cerebras routing');
  const small=modelName(route.smallModel ?? AGENT_MODEL),large=modelName(route.largeModel ?? AGENT_MODEL);
  if (process.env.CEREBRAS_MODEL !== undefined && (small !== AGENT_MODEL || large !== AGENT_MODEL)) throw Error('CEREBRAS_MODEL conflicts with the saved profile. Update its reviewed model routing or select a separate profile.');
  return {CEREBRAS_MODEL:large,CEREBRAS_SMALL_MODEL:small,CEREBRAS_LARGE_MODEL:large};
}
