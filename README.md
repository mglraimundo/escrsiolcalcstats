# ESCRS IOL Calculator — Usage Statistics Dashboard

A static, zero-build dashboard that visualises Google Analytics export data for the
ESCRS IOL Calculator. Deploys to GitHub Pages.

Three views:

- **Overview** — monthly users / sessions line chart, avg session duration, KPI cards.
- **Countries** — world choropleth map (D3 + Natural Earth 110m), continent rollup, searchable table.
- **Calculators** — stacked bar chart of calculations over time, per-calculator totals, flag filters.

Every table can be exported as CSV; every chart as a high-res PNG; the map also as SVG
(vector, print-ready). Exports always reflect the currently filtered/sorted view.

## Project layout

```
/
├── index.html                   # single page, three tabs
├── assets/css/style.css
├── assets/js/
│   ├── app.js                   # boot, tab routing, data fetch
│   ├── util.js                  # shared formatting / table helpers
│   ├── export.js                # CSV / PNG / SVG download helpers
│   ├── overview.js              # Overview tab
│   ├── countries.js             # Countries tab (D3 map)
│   └── calcs.js                 # Calculators tab
├── data/                        # generated + committed JSON bundles
│   ├── overall.json
│   ├── countries.json
│   ├── calcs.json
│   ├── meta.json
│   └── world-110m.json          # Natural Earth 110m (from world-atlas)
├── scripts/build_data.py        # xlsx → JSON converter
├── ga/ga17042026.xlsx           # source Google Analytics export
└── .github/workflows/pages.yml  # GitHub Pages deploy
```

## Regenerating the data bundle

Uses [`uv`](https://docs.astral.sh/uv/) for Python. From the repo root:

```bash
uv sync                            # one-time: install openpyxl into .venv
uv run python scripts/build_data.py
```

That rewrites `data/overall.json`, `data/countries.json`, `data/calcs.json`, and
`data/meta.json` from whatever xlsx lives in `ga/`. Commit those JSON files — the
dashboard loads them at runtime, so GitHub Pages serves them directly without any
build step.

If you drop in a newer GA export, update the filename in `scripts/build_data.py`
(`XLSX = ...`) and re-run the command.

## Running locally

The site is pure static HTML/JS — any static server works. The simplest:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

(`file://` won't work because the page loads JSON via `fetch`.)

## Deploying

Push to `main` / `master`. The workflow at `.github/workflows/pages.yml` uploads the
whole repo as a Pages artifact and publishes. Make sure Pages is enabled in repo
settings with *Build and deployment → Source: GitHub Actions*.

## Data notes

- The `overall` sheet contains month-0 rows per year, which look like GA's year-level
  deduplicated-users aggregates (unique users across the whole year, not a sum of
  months). The build script routes those into `overall.yearly` and keeps the monthly
  series in `overall.monthly`.
- The xlsx has duplicated monthly rows (spreadsheet artifact). The build script
  dedupes by `(Year, Month)`.
- Country names come from GA. The map uses Natural Earth 110m, which omits tiny-island
  countries (Andorra, Aruba, Malta, Singapore, …). Those still appear in the table and
  continent rollup, just not on the map. The map notes unrendered countries in a
  caption below the legend.
- `(not set)` / Unknown-continent rows are preserved in the table but excluded from
  the continent rollup chart.
