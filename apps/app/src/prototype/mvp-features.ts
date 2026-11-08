import { browserDevProfile } from '../browser/dev-profile';
import { admittedAospViews, aospImage } from '../runtime/aosp-image';
// Approved October 12 scope: docs/implementation-plan.md and issue #422.
// Wallet is removed from MVP, including AOSP: no payment/provider activation.
// Phone, Contacts and SMS: owner decision P-36 (issue #420). They exist only on the Alpha AOSP
// image, never in a standalone APK or another non-image install; the launcher flavor alone is not
// proof of the image (runtime/aosp-image.ts). On the image an app view opens only once its in-app
// surface is backed by a reviewed native adapter, so no simulated call, message or address book is
// reachable anywhere.
// Reference definitions and saved user data are retained; development fixtures are non-product.
export const ENABLED_MVP_VIEWS = new Set([
  // "phone", // Alpha AOSP image only: admitted with its native adapter (runtime/aosp-image.ts).
  // "messages", // SMS UI: Alpha AOSP image only. This does not defer email.
  "inbox", "calendar", "browser", "camera", "photos", "maps", "notes",
  // "contacts", // Alpha AOSP image only, once its adapter is admitted.
  "files",
  // "wallet", // Removed from MVP in both distributions and AOSP; no payment flow.
  "workflows", "settings",
]);
const IMAGE_VIEWS: ReadonlySet<string> = new Set(admittedAospViews(aospImage));
for (const view of IMAGE_VIEWS) ENABLED_MVP_VIEWS.add(view);
/** Views unavailable in this install: deferred, or image-only without the verified image and an admitted adapter. */
export const DEFERRED_MVP_VIEWS = new Set(["phone", "messages", "contacts", "wallet"].filter(view => !ENABLED_MVP_VIEWS.has(view)));
// Development-server fixtures only (browserDevProfile requires devSurfacesEnabled); never a product scope
// change and never the AOSP image capability, which stays false in every browser and test-mocks build.
if(browserDevProfile){for(const view of DEFERRED_MVP_VIEWS)ENABLED_MVP_VIEWS.add(view);DEFERRED_MVP_VIEWS.clear();}
export function isMvpView(view: string) { return ENABLED_MVP_VIEWS.has(view); }
const PROMPT_VIEWS: Record<string, string> = { phone: "phone", dialer: "phone", call: "phone", dial: "phone", sms: "messages", messages: "messages", text: "messages", "text message": "messages", contacts: "contacts" };
const UNAVAILABLE_PROMPT = /^(?:(?:open|show|go to|launch)\s+(?:the\s+)?(phone|dialer|sms|messages|contacts|wallet)(?:\b)|(call|dial|text|sms|pay)\b|(?:send|write)\s+(?:an?\s+)?(sms|text message)\b)/i;
/** True when a local quick command names an app that is unavailable in this install. A telephony
 * command passes only on the verified image where its view is admitted (development fixtures never
 * admit one); Wallet and pay never pass. */
export function deferredMvpPrompt(text: unknown) {
  const match = UNAVAILABLE_PROMPT.exec(String(text).trim());
  if (!match) return false;
  const view = PROMPT_VIEWS[(match[1] || match[2] || match[3] || "").toLowerCase()];
  return !view || !(view === "contacts" ? !browserDevProfile && isMvpView("contacts") : IMAGE_VIEWS.has(view));
}

/** Admits Contacts from the native image capability at runtime; other image views are fixed at load (IMAGE_VIEWS). */
export function admitImageContacts(admitted:boolean){if(browserDevProfile)return;if(admitted){ENABLED_MVP_VIEWS.add("contacts");DEFERRED_MVP_VIEWS.delete("contacts");}else{ENABLED_MVP_VIEWS.delete("contacts");DEFERRED_MVP_VIEWS.add("contacts");}}
