package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.contacts.AddressBookPlugin;
import android.Manifest;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Alpha image-only address book: the shared AOSP profile address book under Alpha's installed plugin
 * name, admitted only on the verified Alpha image. Android owns contact creation/edit account choice and save.
 */
@CapacitorPlugin(name="AlphaContacts",permissions={@Permission(alias="contacts",strings={Manifest.permission.READ_CONTACTS})})
public final class AlphaContactsPlugin extends AddressBookPlugin {
 @Override protected boolean admitted(){return AlphaImageCapabilities.aospImage(getContext());}
 @Override protected String unavailableMessage(){return "Contacts is available only in the unlocked Alpha image";}
 @Override protected String closedMessage(){return LateLaunch.CLOSED;}
}
