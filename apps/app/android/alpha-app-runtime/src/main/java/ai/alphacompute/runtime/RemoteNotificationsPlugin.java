package ai.alphacompute.runtime;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Core-proxied {@code ElizaNotifications} Capacitor plugin delegating notification mirroring and workflow notices to AlphaCore. */
@CapacitorPlugin(name = "ElizaNotifications")
public final class RemoteNotificationsPlugin extends CorePluginProxy {
    @Override protected String corePluginName() { return "ElizaNotifications"; }

    @PluginMethod public void status(PluginCall call) { forwardToCore(call, "status"); }
    @PluginMethod public void list(PluginCall call) { forwardToCore(call, "list"); }
    @PluginMethod public void dismiss(PluginCall call) { forwardToCore(call, "dismiss"); }
    @PluginMethod public void clear(PluginCall call) { forwardToCore(call, "clear"); }
    @PluginMethod public void open(PluginCall call) { forwardToCore(call, "open"); }
    @PluginMethod public void openChannelSettings(PluginCall call) { forwardToCore(call, "openChannelSettings"); }
    @PluginMethod public void openNotificationAccess(PluginCall call) { forwardToCore(call, "openNotificationAccess"); }
    @PluginMethod public void crossAppStatus(PluginCall call) { forwardToCore(call, "crossAppStatus"); }
    @PluginMethod public void resumeCrossApp(PluginCall call) { forwardToCore(call, "resumeCrossApp"); }
    @PluginMethod public void notificationApps(PluginCall call) { forwardToCore(call, "notificationApps"); }
    @PluginMethod public void notificationHistory(PluginCall call) { forwardToCore(call, "notificationHistory"); }
    @PluginMethod public void clearNotificationHistory(PluginCall call) { forwardToCore(call, "clearNotificationHistory"); }
    @PluginMethod public void setNotificationPolicy(PluginCall call) { forwardToCore(call, "setNotificationPolicy"); }
    @PluginMethod public void noticeOwner(PluginCall call) { forwardToCore(call, "noticeOwner"); }
    @PluginMethod public void workflowPresentationCapabilities(PluginCall call) { forwardToCore(call, "workflowPresentationCapabilities"); }
    @PluginMethod public void workflowApprovalScope(PluginCall call) { forwardToCore(call, "workflowApprovalScope"); }
    @PluginMethod public void postWorkflow(PluginCall call) { forwardToCore(call, "postWorkflow"); }
    @PluginMethod public void postWorkflowApproval(PluginCall call) { forwardToCore(call, "postWorkflowApproval"); }
    @PluginMethod public void withdrawWorkflowApproval(PluginCall call) { forwardToCore(call, "withdrawWorkflowApproval"); }
    @PluginMethod public void resumeWorkflowApproval(PluginCall call) { forwardToCore(call, "resumeWorkflowApproval"); }
    @PluginMethod public void pendingWorkflowTap(PluginCall call) { forwardToCore(call, "pendingWorkflowTap"); }
    @PluginMethod public void consumeWorkflowTap(PluginCall call) { forwardToCore(call, "consumeWorkflowTap"); }
    @PluginMethod public void workflowReceipt(PluginCall call) { forwardToCore(call, "workflowReceipt"); }
}
