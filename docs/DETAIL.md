# Enkeep

A DeepSeek Harness plugin bundle skeleton.

## What it does

Nothing yet — this repository currently contains the minimal valid bundle structure: a manifest, a patch that inserts one plugin row, a Host plugin entry, locale metadata, and an icon. Capabilities will be added here as they are designed.

## Install

```sh
dsh plugin --profile web add github:80779898/dsh-enkeep
```

For git-based installation, pnpm must be allowed to run build scripts. This bundle is plain JavaScript with no `prepare` script, so no build approval is needed.

## Compatibility

Requires DSH `^0.2.1-rc.2` (declared in `engines.dsh`).

## Limitations

No capabilities, configuration, or Client-side module are implemented yet.
