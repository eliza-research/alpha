import {productionCloud} from '../apps/app/src/runtime/cloud-deployment.generated.ts';

/** The admitted native module declares only this product's Cloud deployment. The shared runtime
 * profile owns routing: it projects the admitted Android provider into the canonical configuration
 * before boot and refuses any other base URL. The protected native store keeps the credential. */
export const nativeCloudRuntime=Object.freeze({apiBaseUrl:productionCloud.api+'/api/v1'});
