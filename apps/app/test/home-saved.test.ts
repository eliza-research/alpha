// spec/app/home/tiles.md, "What was saved comes back as it was saved, an empty Home included; with no record Home shows its defaults"
import { Effect } from "effect";
import { expect, it } from "vitest";
import { parsedTiles } from "../src/home/saved.vibe";

it("Uses Home defaults to complete older launcher records while preserving the owner's explicit tiles", async () => {
  const legacy = (keys: readonly string[]) => Effect.runPromise(parsedTiles((key) =>
    Effect.succeed(key === "alpha.launcher.favorites.v1" ? JSON.stringify({ version: 1, keys }) : undefined)));

  const supplemental = await legacy(["alpha:settings", "com.example.reader", "alpha:notes"]);
  expect(supplemental.found).toBe("Saved");
  expect(supplemental.tiles).toEqual([
    { tag: "Own", view: "Settings" },
    { tag: "Installed", app: "com.example.reader" },
    { tag: "Own", view: "Notes" },
    ...["Phone", "Messages", "Inbox", "Telegram", "Slack", "Calendar", "Clock", "Reminders", "Browser", "Camera", "Photos", "Maps", "Contacts", "Files", "Workflows", "Wallet"]
      .map((view) => ({ tag: "Own", view })),
  ]);

  const selected = await legacy(["alpha:wallet", "alpha:clock", "alpha:reminders", "alpha:telegram", "alpha:slack", "alpha:notes"]);
  expect(selected.tiles.slice(0, 6)).toEqual([
    { tag: "Own", view: "Wallet" },
    { tag: "Own", view: "Clock" },
    { tag: "Own", view: "Reminders" },
    { tag: "Own", view: "Telegram" },
    { tag: "Own", view: "Slack" },
    { tag: "Own", view: "Notes" },
  ]);
  expect(selected.tiles.filter((tile) => tile.tag === "Own" && tile.view === "Wallet")).toHaveLength(1);

  const sunday = await legacy(["alpha:files", "alpha:inventory", "alpha:automations"]);
  expect(sunday.tiles.slice(0, 3)).toEqual([{ tag: "Own", view: "Files" }, { tag: "Own", view: "Wallet" }, { tag: "Own", view: "Workflows" }]);
});
