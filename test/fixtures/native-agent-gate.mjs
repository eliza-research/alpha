import assert from 'node:assert/strict';

/** Compile the shipped gate and its leaf methods, with host ports supplied by each test. */
export function nativeAgentGate(source) {
 const helpersStart=source.indexOf(' static boolean conversationReadPathAllowed(');
 const helpersEnd=source.indexOf(' private static void logRequestFailure(',helpersStart);
 const request=source.indexOf(' @PluginMethod public void request(PluginCall call)');
 const declarationsStart=source.indexOf('  boolean invalidRoute;',request);
 const gateStart=source.indexOf('  if(invalidRoute',declarationsStart);
 const gateEnd=source.indexOf('){\n   logRequestFailure(',gateStart);
 assert(helpersStart>=0&&helpersEnd>helpersStart&&request>=0&&declarationsStart>request&&gateStart>declarationsStart&&gateEnd>gateStart,'Native request gate boundaries must match shipped source');
 return {helpers:source.slice(helpersStart,helpersEnd),declarations:source.slice(declarationsStart,gateStart),condition:source.slice(gateStart+5,gateEnd)};
}
