// spec/app/shell/index.md, "Phone and Messages exist only on an Alpha image, and Contacts only where that image admits it"
import { always } from "@antithesishq/bombadil";
import { extract } from "@antithesishq/bombadil/browser";

const offersImageApp = extract(({ document }) => {
  const imageOnly = ["Phone", "Messages", "Contacts"];
  const addToHome = [...document.querySelectorAll('[role="dialog"]')]
    .find((dialog) => dialog.querySelector("h2")?.textContent === "Add to Home");
  return imageOnly.some((view) => document.querySelector(`[data-home-tile="view:${view}"], [data-launcher-app="view:${view}"]`) !== null)
    || [...(addToHome?.querySelectorAll("button") ?? [])].some((row) => imageOnly.includes(row.textContent?.trim() ?? ""));
});

/** A browser is no Alpha image, so its Home never offers the apps only an image admits. */
export const shellImageAppsAreNotOffered = always(() => !offersImageApp.current);
