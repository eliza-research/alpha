import product from '../../../../config/alpha-product.json' with { type: 'json' };
import {productionCloud} from '../runtime/cloud-deployment.generated.ts';

/** Alpha's admitted Cloud deployment for the resident's text inference. The shared
 * upstream runtime profile (packages/app native-runtime-profile.ts) owns every routing
 * decision; the protected native store keeps the credential. */
const {characterName,appName}=product.identity;
if(!characterName.trim()||!appName.trim())throw Error('Product character identity is required');
/** Same product registration as scripts/agent-identity.mjs; no persisted agent ID or system prompt. */
export const nativeCloudRuntime=Object.freeze({apiBaseUrl:productionCloud.api+'/api/v1',productCharacter:Object.freeze({name:characterName,bio:Object.freeze([`The assistant built into ${appName} for writing, research, decisions and practical follow-through.`])})});
