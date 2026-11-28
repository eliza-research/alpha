package ai.alphacompute.thinapp;

import ai.eliza.plugins.contacts.AddressBookPlugin;
import android.Manifest;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/** Thin standalone {@code ElizaContacts} plugin over Android's address book with deferred deletion Undo support. */
@CapacitorPlugin(name = "ElizaContacts", permissions = {
    @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS })
})
public final class ThinContactsPlugin extends AddressBookPlugin {
    @Override protected boolean admitted() {
        return true;
    }

    @Override protected DeletionWindow deletionWindow() {
        if (!ThinDeletionBridge.available()) return null;
        return (kind, target) -> ThinDeletionBridge.stage(getContext(), kind, target);
    }
}
