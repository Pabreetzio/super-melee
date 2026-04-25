# UQM Local Build Notes

Quick notes for future side-by-side testing against the original game.

## Source Tree

- Keep the original source at [uqm-0.8.0](c:/Projects/super-melee/uqm-0.8.0).
- We built it locally on Windows with MSYS2 `MINGW32`.

## Build / Run

- Build command:
```sh
cd /c/Projects/super-melee/uqm-0.8.0
./build.sh uqm
```
- Launch helper:
  [run-uqm-debug.bat](c:/Projects/super-melee/uqm-0.8.0/run-uqm-debug.bat)
- The launcher reuses installed content from:
  `C:\Program Files (x86)\The Ur-Quan Masters\content`
- It uses a separate config/log directory:
  `%APPDATA%\uqm-source-debug`

## Local Patches We Needed

- [src/uqm.c](c:/Projects/super-melee/uqm-0.8.0/src/uqm.c)
  MinGW build uses system `getopt.h`.
- [src/uqm/supermelee/netplay/nc_connect.ci](c:/Projects/super-melee/uqm-0.8.0/src/uqm/supermelee/netplay/nc_connect.ci)
  Modern MinGW wanted `socklen_t` in the connect callback signature.
- [build/unix/make/buildtools-generic](c:/Projects/super-melee/uqm-0.8.0/build/unix/make/buildtools-generic)
  Incremental rebuilds needed help reconstructing the source path from object paths.

## Important Gotcha

- Do not leave copied runtime DLLs in the UQM source root while building.
- They can shadow MinGW runtime DLLs and make the compiler/linker crash or fail strangely.
- We moved those DLLs to:
  `uqm-0.8.0/runtime-dll-backup/`

## Zoom Takeaways

- Visible stepped melee zoom is `r=0..2`, not `r=0..3`.
- UQM constants:
  `MAX_REDUCTION = 3`, `MAX_VIS_REDUCTION = 2`
- In stepped zoom, Super Melee only uses the visible range.
- In smooth 3DO zoom, the live reduction range we observed was `256..1024`.
- Practical takeaway for the port:
  use only the visible `1x / 2x / 4x` zoom levels for battle rendering.
