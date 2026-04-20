# ESCRS IOL Calculator Stats Dashboard

Static web dashboard showing ESCRS IOL Calculator usage statistics, built from Google Analytics exports and transaction CSV files.

## Data pipeline

### Google Analytics (Overview, Countries, Formulas tabs)

Place the GA export spreadsheet at `ga/ga17042026.xlsx`, update the filename in `scripts/build_data.py` if needed, then run:

```bash
uv run python scripts/build_data.py
```

Writes `data/overall.json`, `data/countries.json`, `data/calcs.json`, `data/meta.json`.

---

### Transaction CSVs (Biometry, IOLs tabs)

Place the raw transaction files at:
- `transactions_csv/2024-CalculationTransactions.csv`
- `transactions_csv/2025-CalculationTransactions.csv`

**Build samples** (for development — 50 rows/day per year):

```bash
uv run python scripts/analyze_transactions.py --create-sample
```

Writes `transactions_csv/sample_2024.csv` and `transactions_csv/sample_2025.csv`. Delete a sample file to force regeneration.

**Export dashboard JSON from samples:**

```bash
uv run python scripts/analyze_transactions.py
```

**Export dashboard JSON from full datasets:**

```bash
uv run python scripts/analyze_transactions.py --full
```

Writes `data/biometry.json` and `data/iols.json`.

**Print analysis to terminal (samples):**

```bash
uv run python scripts/analyze_transactions.py --analyze
```

**Print analysis to terminal (full datasets):**

```bash
uv run python scripts/analyze_transactions.py --analyze --full
```

---

## Running locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

(`file://` won't work because the page loads JSON via `fetch`.)

## Deploying

Before committing, stamp asset URLs with the current git hash to bust browser caches:

```bash
uv run python scripts/stamp_version.py
```

Then push to `main` / `master`. The workflow at `.github/workflows/pages.yml` uploads the whole repo as a Pages artifact and publishes. Make sure Pages is enabled in repo settings with *Build and deployment → Source: GitHub Actions*.
