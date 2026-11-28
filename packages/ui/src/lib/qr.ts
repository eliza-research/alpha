import qrcode from "qrcode-generator";

/** The dark modules of a UTF-8 byte-mode QR code at error correction level L, without its quiet zone. */
export function qrModules(value: string): boolean[][] | undefined {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 2953) return undefined;
  const code = qrcode(0, "L");
  code.addData(String.fromCharCode(...bytes), "Byte");
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => code.isDark(row, column)));
}
