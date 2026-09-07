// The 1541 disk-drive ROM, which the VIEWER supplies and we never ship.
//
// A Commodore 1541 is a computer of its own: its own CPU, its own 16 KB of
// firmware, and it — not the C64 — reads the disk. The free MEGA65 Open ROMs
// we boot with cover BASIC, KERNAL and the character set, but there is no
// free drive ROM anywhere (measured 2026-09-07: MEGA65's own STATUS.md lists
// the floppy drive as NOT DONE, and the one clean-room MIT image is refused
// by the emulator, see the round doc). So a disk image cannot start here
// unless someone who owns a drive ROM puts it in.
//
// This module is the gate for that file. It answers ONE question — will the
// emulator accept these bytes — using the same table the emulator uses
// (VirtualC64, Emulator/Media/RomFile.cpp). Checking here rather than letting
// the emulator refuse it silently is the whole point: a viewer who picks the
// wrong file gets told which file they picked, in the same second.
//
// Nothing here fetches, hosts or names a source for a ROM. The bytes arrive
// from the viewer's own disk and stay in their own browser.

export interface DriveRomSignature {
  size: number;
  offset: number;
  magic: readonly [number, number, number];
  label: string;
}

/**
 * Exactly what VirtualC64 recognises, in its order. A drive ROM is matched by
 * SIZE plus three bytes at an offset — not by a checksum — so this table is
 * short and can be kept honest against theirs.
 */
export const DRIVE_ROM_SIGNATURES: readonly DriveRomSignature[] = [
  { size: 0x4000, offset: 0x0000, magic: [0x97, 0xaa, 0xaa], label: "Commodore 1541" },
  { size: 0x4000, offset: 0x0000, magic: [0x97, 0xe0, 0x43], label: "Commodore 1541" },
  { size: 0x4000, offset: 0x0000, magic: [0x97, 0x46, 0xad], label: "Commodore 1541" },
  { size: 0x4000, offset: 0x0000, magic: [0x97, 0xdb, 0x43], label: "Commodore 1541" },
  { size: 0x6000, offset: 0x0000, magic: [0x4c, 0x4b, 0xa3], label: "Dolphin DOS" },
  { size: 0x8000, offset: 0x2000, magic: [0x4c, 0x4b, 0xa3], label: "Dolphin DOS" },
];

export type DriveRomVerdict = { ok: true; label: string } | { ok: false; reason: string };

const KB = (n: number): string => `${Math.round(n / 1024)} KB`;

/** Does the emulator know these bytes as a drive ROM, and if not, why not? */
export function identifyDriveRom(bytes: Uint8Array): DriveRomVerdict {
  for (const s of DRIVE_ROM_SIGNATURES) {
    if (bytes.length !== s.size) continue;
    if (s.magic.every((b, i) => bytes[s.offset + i] === b)) return { ok: true, label: s.label };
  }
  const sizes = [...new Set(DRIVE_ROM_SIGNATURES.map((s) => s.size))].map(KB).join(", ");
  if (!DRIVE_ROM_SIGNATURES.some((s) => s.size === bytes.length)) {
    return { ok: false, reason: `That file is ${KB(bytes.length)}. A drive ROM is ${sizes}.` };
  }
  // Right size, wrong bytes: almost always a disk image or a C64-side ROM, and
  // occasionally a free replacement the emulator has never been taught.
  return { ok: false, reason: "That is the right size but not a drive ROM the emulator knows — it accepts the original 1541 image, or Dolphin DOS." };
}

/** A drive ROM the viewer has installed, as it is kept. */
export interface StoredDriveRom {
  /** The file's own name, shown back so the viewer can see what they picked. */
  name: string;
  /** Which ROM the table matched. */
  label: string;
  /** The bytes, base64 — localStorage holds text. */
  data: string;
}

export function encodeRom(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function decodeRom(data: string): Uint8Array {
  const s = atob(data);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Disks are the only thing a drive ROM unlocks; everything else already runs. */
export function isDiskImage(url: string): boolean {
  return /\.(d64|g64)(\?|#|$)/i.test(url);
}
