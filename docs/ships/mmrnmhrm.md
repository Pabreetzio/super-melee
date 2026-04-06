# Mmrnmhrm X-Form

Reference: `uqm-0.8.0/src/uqm/ships/mmrnmhrm/mmrnmhrm.c`

## Implemented

- X-form uses the twin forward laser.
- Y-form swaps to the Y-wing body art and fires paired tracking torpedoes.
- Transform spends the full battery and swaps movement/regen/weapon behavior.
- Variant primary/secondary sounds are dispatched through explicit spawn sound keys.

## Notes

- The transform now uses the dedicated `ywing-*` sprites from extracted assets.
- Torpedoes use the extracted `torpedo-*` art instead of placeholder dots.
- X-form laser damage currently follows the existing immediate-weapon line test
  used by this battle architecture rather than spawning separate UQM laser elements.
