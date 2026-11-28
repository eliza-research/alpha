import { Button, TabsList, TabsTrigger, cn } from "@repo/ui";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { ContactsGlyph, Dialpad, RecentsGlyph, VoicemailGlyph } from "./icons.ts";

export interface PhoneTabsProps {
  title: string;
  contacts: boolean;
  voicemail: boolean;
  unheard: boolean;
  onBack?: () => void;
  backLabel?: string;
  /** Actions shown on the right of the single header row, such as New contact. */
  children?: ReactNode;
}

/**
 * The top inset of Phone and Contacts headers: clears the status bar unconditionally (`--alpha-native-inset-top` or
 * `safe-area-inset-top`), keeps the 44px launcher bar clearance on Home, and resets to `mt-0` when the live call strip
 * occupies the top of the screen.
 */
export const telephonyHeader = cn(
  "mt-[calc(max(var(--alpha-native-inset-top,0px),env(safe-area-inset-top))+--spacing(0.5))] shrink-0",
  "in-data-[alpha-launcher]:mt-[max(--spacing(11),calc(max(var(--alpha-native-inset-top,0px),env(safe-area-inset-top))+--spacing(2)))] in-data-[alpha-launcher]:min-h-14 in-data-[alpha-launcher]:gap-1",
  "in-data-[alpha-launcher]:[&>button[aria-label]:not([aria-label^=Back])]:size-11 in-data-[alpha-launcher]:[&>button[aria-label]:not([aria-label^=Back])]:min-w-11",
  "in-[main:has([data-alpha-call-strip=over])]:mt-0 in-data-[alpha-launcher]:in-[main:has([data-alpha-call-strip=over])]:mt-0",
);

const tabs = [
  { name: "Recents", Icon: RecentsGlyph },
  { name: "Keypad", Icon: Dialpad },
  { name: "Voicemail", Icon: VoicemailGlyph },
  { name: "Contacts", Icon: ContactsGlyph },
] as const;

/**
 * Single-row Phone header: optional Back on the left, centered Recents/Keypad/(Voicemail)/Contacts icon pill in the
 * middle with an accessible screen-reader title, and view actions (such as New contact) on the right.
 */
export function PhoneTabs({ title, contacts, voicemail, unheard, onBack, backLabel = "Back to apps", children }: PhoneTabsProps) {
  const selector = (
    <TabsList aria-label="Phone" className="gap-0.5 rounded-panel p-[3px]">
      {tabs.map(({ name, Icon }) => {
        if ((name === "Voicemail" && !voicemail) || (name === "Contacts" && !contacts)) return null;
        return (
          <TabsTrigger key={name} value={name} data-alpha-phone-tab={name.toLowerCase()}
            className="relative grid h-11 w-12 flex-none place-items-center px-0 text-foreground transition-none">
            <Icon aria-hidden className="size-5" />
            <span className="sr-only">{name}</span>
            {name === "Voicemail" && unheard && <span role="img" aria-label="Unheard voicemail"
              className="absolute top-2 right-2.5 size-2 rounded-full bg-primary" />}
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
  return (
    <header data-host-chrome="" data-alpha-phone-header=""
      className={cn(telephonyHeader, "grid min-h-14 grid-cols-[1fr_auto_1fr] items-center gap-1 px-2 py-1")}>
      <div className="flex items-center justify-start">
        {onBack && <Button variant="ghost" size="icon" aria-label={backLabel} className="rounded-lg" onClick={onBack}><ChevronLeft /></Button>}
      </div>
      <div className="flex items-center justify-center">
        <h1 className="sr-only">{title}</h1>
        {selector}
      </div>
      <div className="flex items-center justify-end">{children}</div>
    </header>
  );
}
