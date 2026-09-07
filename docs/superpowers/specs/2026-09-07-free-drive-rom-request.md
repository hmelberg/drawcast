# A one-row request: let the free 1541 ROM be recognised

Ready to post as an issue on `vc64web/virtualc64web` (the WASM build we embed)
and/or `dirkwhoffmann/virtualc64` (upstream, same table). Not posted — that is
Hans's to send, from his own account.

## Why this file exists

drawcast embeds vc64web with the MEGA65 Open ROMs, so a Commodore 64 in a
figure runs on nothing but freely licensed code. Disk images are the one gap:
they need a 1541 ROM, and there is now a free one — but it is refused before
it is ever tried, because drive ROMs are matched against a table of original
Commodore images.

## The draft

> **Recognise the free Pascual DOS 1541 ROM**
>
> `RomFile::signatures` accepts a VC1541 ROM only when the file is 16384 bytes
> AND begins with one of four original Commodore signatures, or matches one of
> the two Dolphin layouts. That means an emulator running entirely on free
> ROMs — Open ROMs for BASIC, KERNAL and chargen — still cannot mount a `.d64`,
> because the only drive ROM it will accept is a copyrighted one.
>
> A clean-room, MIT-licensed 1541 DOS ROM now exists:
> https://github.com/Pascual-Candel-Palazon/Pascual_DOS-1541 — a flat 16384-byte
> image, verified functionally in VICE with true drive emulation, with a
> documented provenance chain (the original ROM is never disassembled or
> consulted). It is the sister project of free BASIC and KERNAL ROMs.
>
> It begins `78 D8 A2`, so `wasm_loadfile("1541.rom", …)` returns `""` and the
> socket stays empty.
>
> Would you consider one more row?
>
> ```c
> { ROM_TYPE_VC1541, 0x4000, 0x0000, { 0x78, 0xD8, 0xA2 } }, // Pascual DOS (MIT)
> ```
>
> That is the smallest possible change and cannot affect any file that matches
> today. The broader alternative — accepting an unrecognised 16384-byte image
> as a drive ROM the way VICE does with `-dos1541` — would also work, but I
> assume you keep the table deliberately so that a mistyped file fails loudly
> rather than booting into nonsense.
>
> One caveat worth stating plainly: that ROM does not implement fast loaders or
> internals-based copy protection, by design. It will not run everything. But it
> would let a fully free setup read an ordinary disk, which is impossible today.

## What it does not solve

The free ROM says in its own README that it does not do fast loaders, and most
commercial disk titles use them. Before leaning on this, measure what it
actually loads: `x64sc -dos1541 dos.bin -drive8type 1541 -drive8truedrive`
against a sample of Archive `.d64` files. VICE is not installed on Hans's
machine yet, so that number does not exist.
