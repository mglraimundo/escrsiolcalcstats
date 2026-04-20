#!/usr/bin/env python3
"""
Transaction CSV analysis pipeline for ESCRS IOL Calculator data.

Usage:
  uv run python scripts/analyze_transactions.py               # export JSONs for dashboard (default)
  uv run python scripts/analyze_transactions.py --full        # export using full datasets
  uv run python scripts/analyze_transactions.py --analyze     # print analysis to terminal
  uv run python scripts/analyze_transactions.py --create-sample  # build samples for all years
"""

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import pandas as pd

ROOT             = Path(__file__).parent.parent
IOL_XML          = ROOT / "misc" / "IOLexport.xml"
DEVICE_MAPPINGS  = ROOT / "misc" / "DeviceMappings.csv"
CHUNKSIZE        = 100_000
ENCODING         = "latin-1"

YEARS = {
    2024: {
        "input":  ROOT / "transactions_csv" / "2024-CalculationTransactions.csv",
        "sample": ROOT / "transactions_csv" / "sample_2024.csv",
    },
    2025: {
        "input":  ROOT / "transactions_csv" / "2025-CalculationTransactions.csv",
        "sample": ROOT / "transactions_csv" / "sample_2025.csv",
    },
}

# ---------------------------------------------------------------------------
# Implausible biometric thresholds — values outside these bounds are recoded
# as NaN before analysis. None means no bound on that side.
# ---------------------------------------------------------------------------
BIOMETRIC_LIMITS: dict[str, tuple[float | None, float | None]] = {
    "AL":     (10.0,  45.0),
    "ACD":    (None,   7.0),
    "CCT":    (250.0, 1000.0),
    "WTW":    (5.0,   18.0),
    "LT":     (None,   8.0),
    "Kdif":   (0.0,   15.0),
    "Target": (-10,   10),
    "SIA":    (0.0,    3.0),
    "INC":    (0.0,  360.0),
}

# Histogram bin edges per metric (edit to adjust resolution/range).
METRIC_BINS: dict[str, list[float]] = {
    "AL":     np.round(np.arange(10.0,  45.5,  0.5),  2).tolist(),
    "K1":     np.round(np.arange(35.0,  55.25, 0.25), 2).tolist(),
    "K2":     np.round(np.arange(35.0,  55.25, 0.25), 2).tolist(),
    "Kdif":   np.round(np.arange(0.0,   15.25, 0.25), 2).tolist(),
    "ACD":    np.round(np.arange(0.0,   7.1,   0.1),  2).tolist(),
    "LT":     np.round(np.arange(2.0,   8.1,   0.1),  2).tolist(),
    "WTW":    np.round(np.arange(5.0,   18.2,  0.2),  2).tolist(),
    "CCT":    [float(v) for v in range(250, 1010, 5)],
    "Target": np.round(np.arange(-6.0,  4.25,  0.25), 2).tolist(),
    "SIA":    np.round(np.arange(0.0,   3.1,   0.1),  2).tolist(),
    # INC is handled separately as circular data — see export_biometry_json
}
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Underscore-ID → IOLcon lens ID mapping
# Underscore-prefixed IDs (e.g. "_340") are custom/private entries in the
# calculator database that don't appear in IOLexport.xml. Add mappings here
# once the corresponding IOLcon IDs are known.
# Format: { "_340": "1234", "_147": "567", ... }
# ---------------------------------------------------------------------------
UNDERSCORE_ID_MAP: dict[str, str] = {
    # "_340": "????",
}
# ---------------------------------------------------------------------------


def load_iol_lookup(
    xml_path: Path = IOL_XML,
    mappings_path: Path = DEVICE_MAPPINGS,
) -> dict[str, tuple[str, str]]:
    """Return {lens_id: (manufacturer, name)}.

    Primary source: IOLexport.xml.
    Fallback for unresolved IDs: DeviceMappings.csv (covers underscore IDs and
    other calculator-internal devices not published to IOLcon).
    """
    lookup: dict[str, tuple[str, str]] = {}

    tree = ET.parse(xml_path)
    for lens in tree.getroot().findall("Lens"):
        lid  = lens.get("id", "")
        mfr  = lens.findtext("Manufacturer", "").strip()
        name = lens.findtext("Name", "").strip()
        lookup[lid] = (mfr, name)

    if mappings_path.exists():
        import csv as _csv
        with open(mappings_path, encoding="utf-8-sig") as f:
            for row in _csv.reader(f):
                if len(row) < 3:
                    continue
                mfr, name, dev_id = row[0].strip(), row[1].strip(), row[2].strip()
                if dev_id and dev_id not in lookup:
                    lookup[dev_id] = (mfr, name)

    for underscore_id, iolcon_id in UNDERSCORE_ID_MAP.items():
        if iolcon_id in lookup:
            lookup[underscore_id] = lookup[iolcon_id]

    return lookup


def resolve_device(device_id: str, lookup: dict[str, tuple[str, str]]) -> str:
    """Return 'Manufacturer — Name' for a device ID, or the raw ID if unknown."""
    entry = lookup.get(str(device_id).strip())
    if entry:
        return f"{entry[0]} — {entry[1]}"
    return str(device_id)


def _read_header(path: Path) -> list[str]:
    with open(path, encoding=ENCODING) as f:
        return f.readline().strip().split("\t")


def open_transactions(path: Path, **kwargs) -> pd.DataFrame:
    """Read a raw transaction CSV (tab-separated header, comma-separated data)."""
    header = _read_header(path)
    return pd.read_csv(
        path, skiprows=1, names=header, sep=",",
        encoding=ENCODING, low_memory=False, **kwargs,
    )


def _bool_flag(series: pd.Series) -> pd.Series:
    return series.astype(str).isin(["1", "True", "true", "1.0"])


def _apply_limits(col: pd.Series, metric: str) -> pd.Series:
    if metric not in BIOMETRIC_LIMITS:
        return col
    lim_lo, lim_hi = BIOMETRIC_LIMITS[metric]
    if lim_lo is not None:
        col = col.where(col >= lim_lo)
    if lim_hi is not None:
        col = col.where(col <= lim_hi)
    return col


def _year_subsets(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    subsets: dict[str, pd.DataFrame] = {"all": df}
    for y in sorted(df["Year"].unique()):
        subsets[str(int(y))] = df[df["Year"] == y]
    return subsets


def _type_subsets(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    toric = _bool_flag(df["Toric"])
    kc    = _bool_flag(df["Keratoconus"])
    lasik = _bool_flag(df["PostLasik"])
    return {
        "all":         df,
        "standard":    df[~toric & ~kc & ~lasik],
        "toric":       df[toric],
        "keratoconus": df[kc],
        "post_lasik":  df[lasik],
    }


_INC_BIN_LABELS = ["350–10°"] + [f"{b}–{b+20}°" for b in range(10, 350, 20)]


def _incision_data(sub: pd.DataFrame) -> dict:
    """Top-10 frequencies and circular histogram for INC (incision meridian)."""
    inc = sub["INC"].dropna()
    n = int(len(inc))
    if n == 0:
        return {"n": 0, "top": [], "bin_labels": _INC_BIN_LABELS,
                "bin_counts": [0] * len(_INC_BIN_LABELS)}
    total_with_val = n
    top10 = inc.value_counts().head(10)
    top = [{"value": float(v), "count": int(c),
            "share": round(int(c) / total_with_val, 4)}
           for v, c in top10.items()]
    bin_counts = [int(((inc >= 350) | (inc < 10)).sum())]
    for b in range(10, 350, 20):
        bin_counts.append(int(((inc >= b) & (inc < b + 20)).sum()))
    return {"n": n, "top": top, "bin_labels": _INC_BIN_LABELS, "bin_counts": bin_counts}


def _laterality(sub: pd.DataFrame) -> dict:
    """Return bilateral/left-only/right-only counts from an eye-level subset."""
    eyes_per_session = sub.groupby("_session_id")["RightEye"].agg(set)
    bilateral  = int((eyes_per_session.apply(lambda s: 0 in s and 1 in s)).sum())
    left_only  = int((eyes_per_session.apply(lambda s: 0 in s and 1 not in s)).sum())
    right_only = int((eyes_per_session.apply(lambda s: 1 in s and 0 not in s)).sum())
    return {"bilateral": bilateral, "left_only": left_only, "right_only": right_only}


def unpack_eyes(df: pd.DataFrame) -> pd.DataFrame:
    """Split each session row into one row per eye, dropping _left/_right prefixes."""
    left_set  = _bool_flag(df["LeftIsSet"])
    right_set = _bool_flag(df["RightIsSet"])

    eye_bases = sorted(c[:-5] for c in df.columns if c.endswith("_left"))
    shared_cols = [c for c in df.columns
                   if not c.endswith("_left") and not c.endswith("_right")
                   and c not in ("RightIsSet", "LeftIsSet")]

    def build_side(mask: pd.Series, suffix: str, right_eye_val: int) -> pd.DataFrame:
        cols   = [f"{b}{suffix}" for b in eye_bases]
        rename = {f"{b}{suffix}": b for b in eye_bases}
        sub = df[mask][shared_cols + cols].copy()
        sub = sub.rename(columns=rename)
        sub["RightEye"] = right_eye_val
        return sub

    return pd.concat(
        [build_side(left_set, "_left", 0), build_side(right_set, "_right", 1)],
        ignore_index=True,
    )


def create_sample(src: Path, dst: Path, n_per_day: int = 50) -> None:
    print(f"Pass 1: scanning DateCreated in {src.name} ...")
    header = _read_header(src)

    dates_chunks: list[pd.DataFrame] = []
    row_offset = 0
    for chunk in pd.read_csv(
        src, skiprows=1, names=header, sep=",",
        usecols=["DateCreated"], chunksize=CHUNKSIZE, encoding=ENCODING, low_memory=False,
    ):
        chunk = chunk.copy()
        chunk["_abs"]  = range(row_offset, row_offset + len(chunk))
        chunk["_date"] = pd.to_datetime(chunk["DateCreated"], errors="coerce").dt.date
        dates_chunks.append(chunk[["_abs", "_date"]])
        row_offset += len(chunk)
        if row_offset % 1_000_000 == 0:
            print(f"  scanned {row_offset:,} rows...")

    print(f"  total rows: {row_offset:,}")
    all_dates = pd.concat(dates_chunks, ignore_index=True)

    rng = np.random.default_rng(42)
    keep_rows: list[int] = []
    for _date, group in all_dates.groupby("_date"):
        idx = group["_abs"].values
        chosen = rng.choice(idx, size=min(len(idx), n_per_day), replace=False)
        keep_rows.extend(chosen.tolist())

    keep_set = set(keep_rows)
    print(f"  keeping {len(keep_set):,} rows across {all_dates['_date'].nunique()} days")

    print(f"Pass 2: writing sample to {dst.name} ...")
    row_offset = 0
    first = True
    for chunk in pd.read_csv(
        src, skiprows=1, names=header, sep=",",
        chunksize=CHUNKSIZE, encoding=ENCODING, low_memory=False,
    ):
        mask     = [i in keep_set for i in range(row_offset, row_offset + len(chunk))]
        filtered = chunk[mask]
        if not filtered.empty:
            filtered.to_csv(dst, mode="w" if first else "a", index=False, header=first)
            first = False
        row_offset += len(chunk)
        if row_offset % 1_000_000 == 0:
            print(f"  processed {row_offset:,} rows...")

    print(f"Done. Sample saved to {dst}")


def _load_df(args: argparse.Namespace) -> pd.DataFrame:
    frames: list[pd.DataFrame] = []
    for year, paths in YEARS.items():
        path  = paths["input"] if args.full else paths["sample"]
        label = "full" if args.full else "sample"
        if not path.exists():
            print(f"  Warning: {year} {label} not found at {path}, skipping."
                  + ("" if args.full else " Run --create-sample to generate it."))
            continue
        print(f"Loading {year} {label}: {path.name} ...")
        df = open_transactions(path) if args.full else pd.read_csv(path, low_memory=False)
        df["Year"] = year
        frames.append(df)

    if not frames:
        sys.exit("No data loaded.")

    combined = pd.concat(frames, ignore_index=True)
    print(f"\nTotal sessions loaded: {len(combined):,}")

    left_set  = _bool_flag(combined["LeftIsSet"])
    right_set = _bool_flag(combined["RightIsSet"])
    total     = len(combined)
    bilateral  = (left_set & right_set).sum()
    left_only  = (left_set & ~right_set).sum()
    right_only = (~left_set & right_set).sum()
    print(f"Laterality: bilateral {bilateral:,} ({100*bilateral/total:.1f}%), "
          f"left-only {left_only:,} ({100*left_only/total:.1f}%), "
          f"right-only {right_only:,} ({100*right_only/total:.1f}%)")

    combined["_session_id"] = range(len(combined))
    print("Unpacking eyes (one row per eye) ...")
    unpacked = unpack_eyes(combined)
    left_n  = (unpacked["RightEye"] == 0).sum()
    right_n = (unpacked["RightEye"] == 1).sum()
    print(f"Eye-level rows: {len(unpacked):,}  (left: {left_n:,}, right: {right_n:,})")

    no_device = unpacked["SelectedDevice"].isna()
    print(f"Dropping {no_device.sum():,} rows with no IOL selected")
    unpacked = unpacked[~no_device].reset_index(drop=True)

    if "TargetRefraction" in unpacked.columns:
        unpacked = unpacked.rename(columns={"TargetRefraction": "Target"})

    # Apply limits first so out-of-range values become NaN before the completeness check.
    for col in ["AL", "K1", "K2", "ACD", "LT", "WTW", "CCT", "Target", "SIA", "INC"]:
        if col in unpacked.columns:
            unpacked[col] = _apply_limits(pd.to_numeric(unpacked[col], errors="coerce"), col)

    REQUIRED_BIOMETRY = ["AL", "K1", "K2", "ACD"]
    missing_bio = unpacked[REQUIRED_BIOMETRY].isna().any(axis=1)
    print(f"Dropping {missing_bio.sum():,} rows missing required biometry (AL, K1, K2, ACD)")
    unpacked = unpacked[~missing_bio].reset_index(drop=True)

    unpacked["Kdif"] = (unpacked["K2"] - unpacked["K1"]).abs()

    return unpacked


# ---------------------------------------------------------------------------
# JSON export functions
# ---------------------------------------------------------------------------

def _demographics(sub: pd.DataFrame) -> dict:
    """Patient-level age and gender stats from an eye-level subset (deduped by _session_id)."""
    patients = sub.drop_duplicates("_session_id")

    age_raw   = pd.to_numeric(patients["PatientAge"], errors="coerce")
    age_valid = age_raw[(age_raw >= 18) & (age_raw <= 110)]
    age_null  = int(len(age_raw) - len(age_valid))
    age_stats: dict = {"n": int(len(age_valid)), "null": age_null}
    if len(age_valid) >= 2:
        age_stats.update({
            "mean": round(float(age_valid.mean()),         1),
            "sd":   round(float(age_valid.std()),          1),
            "p25":  round(float(age_valid.quantile(0.25)), 1),
            "p50":  round(float(age_valid.quantile(0.50)), 1),
            "p75":  round(float(age_valid.quantile(0.75)), 1),
            "min":  round(float(age_valid.min()),          1),
            "max":  round(float(age_valid.max()),          1),
        })

    gender_counts = patients["PatientGender"].value_counts(dropna=False)
    gender: dict[str, int] = {
        (str(k) if k == k else "(not set)"): int(v)   # NaN check via k==k
        for k, v in gender_counts.items()
    }

    return {"age": age_stats, "gender": gender}


def export_biometry_json(df: pd.DataFrame) -> None:
    out_path = ROOT / "data" / "biometry.json"
    summary_rows: list[dict] = []
    hist_rows: list[dict] = []
    laterality_rows: list[dict] = []
    demographics_rows: list[dict] = []
    incision_rows: list[dict] = []

    for year_key, year_df in _year_subsets(df).items():
        for type_key, sub in _type_subsets(year_df).items():
            lat = _laterality(sub)
            laterality_rows.append({"year": year_key, "type": type_key, **lat})
            dem = _demographics(sub)
            demographics_rows.append({"year": year_key, "type": type_key, **dem})
            eye_subsets = {
                "all":   sub,
                "right": sub[sub["RightEye"] == 1],
                "left":  sub[sub["RightEye"] == 0],
            }
            for eye_key, eye_sub in eye_subsets.items():
                inc = _incision_data(eye_sub)
                incision_rows.append({"year": year_key, "type": type_key, "eye": eye_key, **inc})
            for metric, edges in METRIC_BINS.items():
                if metric not in sub.columns:
                    continue
                valid = pd.to_numeric(sub[metric], errors="coerce").dropna()
                if len(valid) < 2:
                    continue

                counts, _ = np.histogram(valid.values, bins=np.array(edges))
                summary_rows.append({
                    "year": year_key, "type": type_key, "metric": metric,
                    "n":   int(len(valid)),
                    "mean": round(float(valid.mean()),          3),
                    "sd":   round(float(valid.std()),           3),
                    "p25":  round(float(valid.quantile(0.25)),  3),
                    "p50":  round(float(valid.quantile(0.50)),  3),
                    "p75":  round(float(valid.quantile(0.75)),  3),
                    "min":  round(float(valid.min()),           3),
                    "max":  round(float(valid.max()),           3),
                })
                hist_rows.append({
                    "year": year_key, "type": type_key, "metric": metric,
                    "counts": counts.tolist(),
                })

    result = {"metric_bins": METRIC_BINS, "summary": summary_rows, "histograms": hist_rows,
              "laterality": laterality_rows, "demographics": demographics_rows,
              "incision": incision_rows}
    out_path.write_text(json.dumps(result, separators=(",", ":")))
    print(f"Wrote {out_path}  ({out_path.stat().st_size // 1024} KB)")


def export_iols_json(df: pd.DataFrame, lookup: dict[str, tuple[str, str]]) -> None:
    out_path = ROOT / "data" / "iols.json"
    mfr_rows:  list[dict] = []
    lens_rows: list[dict] = []

    for year_key, year_df in _year_subsets(df).items():
        for type_key, sub in _type_subsets(year_df).items():
            if len(sub) == 0:
                continue

            mfr_counts = sub["SelectedManufacturer"].value_counts(dropna=True)
            mfr_total = int(mfr_counts.sum())
            if mfr_total == 0:
                continue

            for mfr, count in mfr_counts.items():
                mfr_rows.append({
                    "year": year_key, "type": type_key,
                    "manufacturer": str(mfr),
                    "count": int(count),
                    "share": round(int(count) / mfr_total, 4),
                })

            lens_counts = (
                sub.groupby(["SelectedManufacturer", "SelectedDevice"], dropna=True)
                .size()
                .reset_index(name="count")
            )
            lens_total = int(lens_counts["count"].sum())
            for _, row in lens_counts.iterrows():
                dev_id = str(row["SelectedDevice"]).strip()
                mfr    = str(row["SelectedManufacturer"])
                count  = int(row["count"])
                entry  = lookup.get(dev_id)
                name   = entry[1] if entry else dev_id
                lens_rows.append({
                    "year": year_key, "type": type_key,
                    "manufacturer": mfr,
                    "name": name,
                    "count": count,
                    "share": round(count / lens_total, 4),
                })

    mfr_rows.sort(key=lambda r: (-r["count"], r["manufacturer"]))
    lens_rows.sort(key=lambda r: (-r["count"], r["manufacturer"], r["name"]))

    out_path.write_text(json.dumps({"manufacturers": mfr_rows, "lenses": lens_rows}, separators=(",", ":")))
    print(f"Wrote {out_path}  ({out_path.stat().st_size // 1024} KB)")


# ---------------------------------------------------------------------------
# Terminal analysis functions (invoked with --analyze)
# ---------------------------------------------------------------------------

def _section(title: str) -> None:
    print()
    print("=" * 70)
    print(f"  {title}")
    print("=" * 70)


def analyze_volume(df: pd.DataFrame) -> None:
    _section("VOLUME OVER TIME")
    df = df.copy()
    df["_dt"]    = pd.to_datetime(df["DateCreated"], errors="coerce")
    df["_date"]  = df["_dt"].dt.date
    df["_month"] = df["_dt"].dt.to_period("M")

    dedup_cols = ["Year", "ID"] if "Year" in df.columns else ["ID"]
    sessions = df.drop_duplicates(subset=dedup_cols)

    daily = sessions.groupby("_date").size().rename("sessions")
    print("\n-- Daily sessions (first 10 / last 10) --")
    pd.set_option("display.max_rows", 20)
    print(daily.head(10).to_string())
    print("  ...")
    print(daily.tail(10).to_string())

    print("\n-- Monthly sessions --")
    if "Year" in df.columns:
        print((sessions.groupby(["Year", "_month"]).size().unstack("Year", fill_value=0)).to_string())
    else:
        print(sessions.groupby("_month").size().rename("sessions").to_string())

    print(f"\nDate range: {daily.index.min()} → {daily.index.max()}")
    print(f"Total days with data: {len(daily)}")
    print(f"Mean sessions/day: {daily.mean():.1f}  Median: {daily.median():.1f}")


def analyze_demographics(df: pd.DataFrame) -> None:
    _section("PATIENT DEMOGRAPHICS")
    dedup_cols = ["Year", "ID"] if "Year" in df.columns else ["ID"]
    patients = df.drop_duplicates(subset=dedup_cols)
    print(f"\n({len(patients):,} unique sessions)")

    print("\n-- Gender --")
    gender = patients["PatientGender"].value_counts(dropna=False)
    total  = gender.sum()
    for val, n in gender.items():
        print(f"  {val}: {n:,} ({100*n/total:.1f}%)")

    print("\n-- Age --")
    age = pd.to_numeric(patients["PatientAge"], errors="coerce")
    valid_age = age[(age >= 18) & (age <= 110)]
    invalid   = age.notna().sum() - len(valid_age)
    print(f"  Valid (18–110): {len(valid_age):,}  excluded: {invalid:,}  missing: {age.isna().sum():,}")
    print(valid_age.describe().round(1).to_string())
    print("\n  Age buckets:")
    bins   = list(range(20, 111, 10))
    labels = [f"{b}–{b+9}" for b in bins[:-1]]
    print(pd.cut(valid_age, bins=bins, labels=labels, right=False).value_counts(sort=False).to_string())


def analyze_devices(df: pd.DataFrame, lookup: dict[str, tuple[str, str]]) -> None:
    _section("IOL DEVICE & MANUFACTURER")
    print(f"\n({len(df):,} eye calculations)")
    print("\nTop manufacturers:")
    print(df["SelectedManufacturer"].value_counts(dropna=False).head(15).to_string())

    df = df.copy()
    dev_str = df["SelectedDevice"].fillna("").astype(str).str.strip()
    df["_lens"] = dev_str.apply(
        lambda x: resolve_device(x, lookup) if x not in ("nan", "") else "(none)"
    )
    has_id     = ~dev_str.isin(["nan", ""])
    unresolved = (has_id & ~dev_str.isin(lookup.keys())).sum()
    lens_counts = (
        df.groupby("_lens", dropna=False).size()
        .reset_index(name="n").sort_values("n", ascending=False).head(25)
    )
    print(f"\nTop lenses (unresolved IDs: {unresolved:,}):")
    print(lens_counts.to_string(index=False))


def analyze_biometrics(df: pd.DataFrame) -> None:
    _section("BIOMETRIC DISTRIBUTIONS")
    METRICS: dict[str, tuple[float, float, str]] = {
        "AL":  (20.0, 35.0, "mm"), "K1":  (35.0, 55.0, "D"),
        "K2":  (35.0, 55.0, "D"),  "ACD": (1.5,  5.5,  "mm"),
        "LT":  (2.0,  6.5,  "mm"), "WTW": (9.0,  14.0, "mm"),
        "CCT": (400,  700,  "µm"),
    }
    for metric, (lo, hi, unit) in METRICS.items():
        if metric not in df.columns:
            continue
        col   = _apply_limits(pd.to_numeric(df[metric], errors="coerce"), metric)
        valid = col.dropna()
        out_of_range = ((valid < lo) | (valid > hi)).sum()
        print(f"\n{metric} ({unit}) — n={len(valid):,}, flagged outside clinical range (<{lo} or >{hi}): {out_of_range}")
        print(valid.describe().round(3).to_string())


def analyze_clinical_flags(df: pd.DataFrame) -> None:
    _section("CLINICAL FLAGS")
    def pct(series: pd.Series, label: str) -> None:
        n = _bool_flag(series).sum()
        print(f"  {label}: {n:,} ({100*n/len(series):.1f}%)")
    print(f"\n({len(df):,} eye calculations)")
    pct(df["Toric"],       "Toric")
    pct(df["PostLasik"],   "Post-LASIK")
    pct(df["Keratoconus"], "Keratoconus")


def main() -> None:
    parser = argparse.ArgumentParser(description="ESCRS IOL Calculator transaction analysis")
    parser.add_argument("--create-sample", action="store_true", help="Build sample files for all years")
    parser.add_argument("--full",          action="store_true", help="Run on full datasets")
    parser.add_argument("--analyze",       action="store_true", help="Print analysis to terminal instead of exporting JSONs")
    parser.add_argument("--n-per-day",     type=int, default=50, help="Rows/day in sample (default: 50)")
    args = parser.parse_args()

    if args.create_sample:
        for year, paths in YEARS.items():
            src, dst = paths["input"], paths["sample"]
            if not src.exists():
                print(f"Skipping {year}: {src} not found")
                continue
            if dst.exists():
                print(f"Skipping {year}: sample already exists at {dst.name} (delete to regenerate)")
                continue
            print(f"\n=== {year} ===")
            create_sample(src, dst, n_per_day=args.n_per_day)
        return

    df     = _load_df(args)
    lookup = load_iol_lookup()
    print(f"IOL lookup: {len(lookup)} lenses from {IOL_XML.name}")

    if args.analyze:
        analyze_volume(df)
        analyze_demographics(df)
        analyze_devices(df, lookup)
        analyze_biometrics(df)
        analyze_clinical_flags(df)
    else:
        export_biometry_json(df)
        export_iols_json(df, lookup)


if __name__ == "__main__":
    main()
