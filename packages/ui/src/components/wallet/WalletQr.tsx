import type { ComponentProps } from "react";
import { cn } from "../../lib/cn.ts";
import { qrModules } from "../../lib/qr.ts";

export type WalletQrProps = Omit<ComponentProps<"svg">, "children"> & {
  /** The text the code holds, such as an address: at most 2953 UTF-8 bytes. */
  value: string;
  /** What the code is, for assistive technology, such as "Ethereum address as a QR code". */
  label: string;
};

const quiet = 4;

/** `value` as a QR code another phone can scan: dark on light in both looks, with the quiet zone a scanner needs. Nothing is drawn for a value too long to hold. */
export function WalletQr({ value, label, className, ...props }: WalletQrProps) {
  const modules = qrModules(value);
  if (!modules) return null;
  const size = modules.length + 2 * quiet;
  const path = modules.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x + quiet} ${y + quiet}h1v1h-1z` : ""))).join("");
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" className={cn("aspect-square w-full max-w-56 rounded-lg bg-background text-foreground dark:bg-foreground dark:text-background", className)} {...props}>
      <path d={path} fill="currentColor" />
    </svg>
  );
}
