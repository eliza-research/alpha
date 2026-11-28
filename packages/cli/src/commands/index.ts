import type { RegisteredCommand } from "../runner.ts";
import { alphaNextCommand } from "./alpha-next.ts";
import { statusCommand } from "./status.ts";

export const commands: readonly RegisteredCommand[] = [statusCommand, alphaNextCommand];
