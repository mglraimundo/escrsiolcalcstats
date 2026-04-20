# CLAUDE.md

## Python

Always run Python scripts and tools with `uv run`, e.g. `uv run python scripts/foo.py`.

## Cache busting

Before committing a deploy, stamp asset URLs with the current git hash:

```bash
uv run python scripts/stamp_version.py
```

This updates `index.html` asset URLs to `?v=<git-short-hash>` so browsers pick up new CSS/JS.
