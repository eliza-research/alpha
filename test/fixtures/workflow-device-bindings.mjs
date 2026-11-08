/**
 * Install the real workflow device registration bindings (workflowDeviceProtocol,
 * registerWorkflowDevice) from apps/app/src/runtime/workflow-presentation.ts into a vm sandbox
 * that extracts connection-ui.tsx. Only the native bridge probe (workflowPresentationProtocol)
 * stays a fixture: the sandbox must already provide it, and the real device-protocol mapping
 * and 409 downgrade run on top of it.
 */
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const file=new URL('../../apps/app/src/runtime/workflow-presentation.ts',import.meta.url);
const probeMarker='/** Probe installed bridge code';
export function installWorkflowDeviceBindings(sandbox){
 if(typeof sandbox.workflowPresentationProtocol!=='function')throw new Error('The sandbox must provide a workflowPresentationProtocol fixture');
 const text=readFileSync(file,'utf8');
 const end=text.indexOf(probeMarker);
 if(end<0)throw new Error('workflow-presentation.ts no longer marks the native bridge probe');
 const source=stripTypeScriptTypes(text.slice(0,end).replace(/^import .*;\n/gm,'').replace(/export /g,''),{mode:'transform'});
 vm.runInContext(source+';globalThis.workflowDeviceProtocol=workflowDeviceProtocol;globalThis.registerWorkflowDevice=registerWorkflowDevice;',vm.isContext(sandbox)?sandbox:vm.createContext(sandbox));
 return sandbox;
}
