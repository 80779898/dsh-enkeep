# dsh-enkeep

> dsh-enkeep makes dsh better.

A DeepSeek Harness (DSH) plugin **bundle** skeleton.

## Status

🚧 Skeleton only — no capabilities implemented yet. See [docs/DETAIL.md](docs/DETAIL.md).

## Structure

```
dsh-enkeep/
├── package.json          # bundle manifest (dsh.bundle.patch) + engines.dsh
├── cordis.patch.yml      # inserts one plugin row, referenced by package name
├── index.js              # Host plugin entry (named exports only)
├── locale/
│   ├── en.json           # meta.title / description / detail (English)
│   └── zh.json           # same metadata (Chinese)
├── docs/
│   └── DETAIL.md         # detail page named by meta.detail
├── icon.svg              # 36×36 self-contained icon
└── .gitignore
```

## Install

```sh
dsh plugin --profile web add github:80779898/dsh-enkeep
```

No build approval is needed: this is plain JavaScript with no `prepare` script.
To verify the composed layer before starting:

```sh
dsh --profile web --dump-config
```

## Compatibility

- DSH: `^0.2.1-rc.2` (see `engines.dsh`)
- Installed DSH when this skeleton was created: `0.2.1-rc.2`

## Development

```sh
node --check index.js     # syntax check
npm pack --dry-run        # verify the packed file list
```

Capabilities will be added after the concrete requirements are defined. Follow
the workflow in `dsh-plugin-dev` skill (`C:\Users\mason\.dsh\skills\dsh-plugin-dev\SKILL.md`).

## Reference

- DSH repository: https://github.com/deepseek-ai/deepseek-harness
- DSH docs: https://deepseek-harness.github.io/deepseek-harness/
