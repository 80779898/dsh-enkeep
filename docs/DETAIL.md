# Enkeep

Two small UI controls for DSH Web, with no dependency on other plugins.

## What it does

- **Chat width toggle** — switch between the native chat column (capped at 920px) and a wide layout that removes the cap and adapts to the available column (640px floor). Configured via `chatWidth` (`narrow` / `wide`).
- **Sidebar launcher** — a button in the sidebar panel row that opens an Enkeep panel in the center column. Show/hide it with `showLauncher` (default: on). Both settings are editable in the Enkeep settings page.

## Install

```sh
dsh plugin --profile web add github:80779898/dsh-enkeep#<commit-sha>
```

Plain JavaScript with no `prepare` script, so no build approval is needed.

## Settings

Open **Settings → Enkeep** to toggle:
- `Show sidebar button`
- `Wide chat column`

Settings are stored in the profile's plugin config as volatile fields and survive restarts.

## Compatibility

Requires DSH `^0.2.1-rc.2` (see `engines.dsh`).

## Limitations

- The wide layout overrides the internal CSS variable `--dsh-chat-content-width`. It works on 0.2.1-rc.2 but depends on an internal variable name; a future DSH release may rename it.
- The sidebar button uses the panel-icon slot above the session list, not a dedicated "workspace header" slot (DSH has no such slot).
