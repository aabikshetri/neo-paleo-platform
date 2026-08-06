from __future__ import annotations

import json
import inspect
import io
import os
from typing import Optional

import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel
from fastapi.responses import StreamingResponse

import numpy as np

from scipy.stats import pearsonr, spearmanr
from scipy.spatial.distance import pdist, squareform
from scipy.spatial import procrustes

from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.manifold import MDS
from sklearn.isotonic import IsotonicRegression

from backend.database import (
    calibration_quality_postgres,
    load_runtime_frames,
    publication_options_postgres,
    search_postgres,
    stream_taxa_csv_postgres,
    taxa_aggregate_postgres,
    taxon_sample_values_postgres,
    using_postgres,
)

app = FastAPI(title="Neo API", version="1.0.0")

# Search responses contain thousands of sample records. Compressing responses
# substantially reduces transfer size for both local and deployed clients.
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=5)

cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

df, taxa_df, dataset_publications_df = load_runtime_frames()
dataset_publications_df["datasetid"] = pd.to_numeric(
    dataset_publications_df["datasetid"], errors="coerce"
).astype("Int64")
dataset_publications_df["publicationid"] = pd.to_numeric(
    dataset_publications_df["publicationid"], errors="coerce"
).astype("Int64")

taxa_df["abundance"] = pd.to_numeric(
    taxa_df["abundance"],
    errors="coerce"
)


def normalize_doi(value):
    if value is None or pd.isna(value):
        return None
    doi = str(value).strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if doi.startswith(prefix):
            doi = doi[len(prefix):].strip()
    return doi or None


def doi_tokens(value):
    if value is None or pd.isna(value):
        return set()
    return {
        normalized
        for token in str(value).split(";")
        if (normalized := normalize_doi(token))
    }

for col in ["pH", "water_table_depth", "altitude"]:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")

# Neotoma exports can contain numeric missing-value sentinels. Remove them
# before summaries, filters, quality checks, and environmental coloring.
if "pH" in df.columns:
    df.loc[(df["pH"] < 0) | (df["pH"] > 14), "pH"] = np.nan
if "water_table_depth" in df.columns:
    df.loc[df["water_table_depth"] <= -90, "water_table_depth"] = np.nan


def get_lon_lat(geo):
    try:
        g = json.loads(geo)

        if g["type"] == "Point":
            lon, lat = g["coordinates"]
            return lon, lat

        if g["type"] == "Polygon":
            ring = g["coordinates"][0]

            lon = sum(p[0] for p in ring) / len(ring)
            lat = sum(p[1] for p in ring) / len(ring)

            return lon, lat

    except Exception:
        pass

    return None, None


def build_summary(df):

    return {
        "samples": int(len(df)),

        "sites": int(
            df["siteid"].nunique()
        ),

        "mean_ph": round(
            df["pH"].dropna().mean(),
            2,
        ),

        "mean_water_table": round(
            df["water_table_depth"]
            .dropna()
            .mean(),
            2,
        ),

        "mean_altitude": round(
            df["altitude"]
            .dropna()
            .mean(),
            2,
        ),
    }


def run_environmental_pca(df):

    cols = [
        "pH",
        "water_table_depth",
        "altitude",
    ]

    temp = (
        df[cols]
        .dropna()
        .copy()
    )

    if len(temp) < 3:
        return {
            "pc1": [],
            "pc2": [],
            "explained_variance": [],
        }

    scaled = (
        StandardScaler()
        .fit_transform(temp)
    )

    pca = PCA(n_components=2)

    pcs = pca.fit_transform(
        scaled
    )

    return {
        "pc1": pcs[:, 0].tolist(),
        "pc2": pcs[:, 1].tolist(),
        "explained_variance":
            pca.explained_variance_ratio_.tolist(),
        "samples": len(temp),
        "variables": cols,
    }


def lump_taxon_name(name: str, level: str = "genus"):
    if not isinstance(name, str):
        return "Unknown"

    name = name.strip()

    if not name:
        return "Unknown"

    if level == "genus":
        return name.split()[0]

    return name


def compute_taxa_lumping(df, level="taxon"):
    taxon_col = "taxon_name"
    abundance_col = "abundance"
    sample_col = "sampleid"

    if taxon_col not in df.columns:
        return {
            "error": f"Missing column: {taxon_col}",
            "available_columns": list(df.columns),
        }

    if abundance_col not in df.columns:
        return {
            "error": f"Missing column: {abundance_col}",
            "available_columns": list(df.columns),
        }

    if sample_col not in df.columns:
        return {
            "error": f"Missing column: {sample_col}",
            "available_columns": list(df.columns),
        }

    temp = df[[sample_col, taxon_col, abundance_col]].copy()

    temp[abundance_col] = pd.to_numeric(
        temp[abundance_col],
        errors="coerce"
    )

    temp = temp.dropna(subset=[sample_col, taxon_col, abundance_col])
    temp = temp[temp[abundance_col] > 0]

    if temp.empty:
        return []

    temp["lumped_taxon"] = temp[taxon_col].apply(
        lambda x: lump_taxon_name(x, level)
    )

    # Values come from a mixture of count (NISP) and percent datasets. Convert
    # every sample to a 100% composition before combining them so the units can
    # never be added together and samples with larger count totals do not get
    # more weight.
    sample_totals = temp.groupby(sample_col)[abundance_col].transform("sum")
    temp["sample_percent"] = temp[abundance_col] / sample_totals * 100

    # Duplicate observations of the same recorded taxon are combined per sample.
    per_sample = (
        temp.groupby([sample_col, "lumped_taxon"], as_index=False)["sample_percent"]
        .sum()
    )
    sample_count = temp[sample_col].nunique()

    result = (
        per_sample.groupby("lumped_taxon")["sample_percent"]
        .sum()
        .div(sample_count)
        .reset_index()
        .rename(columns={"sample_percent": "percentage"})
        .sort_values("percentage", ascending=False)
    )

    # Keep the legacy field while clients migrate; its value is now explicitly
    # a percentage, not a mixture of counts and percentages.
    result["abundance"] = result["percentage"]

    return result.to_dict(orient="records")


def build_taxon_profiles(source):
    """Normalize once per sample at Neotoma's finest recorded taxon level."""
    temp = source[["sampleid", "taxon_name", "abundance"]].copy()
    temp["abundance"] = pd.to_numeric(temp["abundance"], errors="coerce")
    temp = temp.dropna(subset=["sampleid", "taxon_name", "abundance"])
    temp = temp[temp["abundance"] > 0]
    temp["lumped_taxon"] = temp["taxon_name"].apply(lambda value: lump_taxon_name(value, "taxon"))
    totals = temp.groupby("sampleid")["abundance"].transform("sum")
    temp["percentage"] = temp["abundance"] / totals * 100
    return (
        temp.groupby(["sampleid", "lumped_taxon"], as_index=False)["percentage"]
        .sum()
        .sort_values(["sampleid", "percentage"], ascending=[True, False])
    )


taxon_profiles_df = build_taxon_profiles(taxa_df)


def limit_taxa_groups(records, limit):
    if limit is None or limit <= 0 or len(records) <= limit:
        return records

    # Reserve one displayed slice for all taxa outside the requested limit.
    kept = records[: max(limit - 1, 0)]
    remainder = records[max(limit - 1, 0):]
    other_percentage = sum(row["percentage"] for row in remainder)

    return kept + [{
        "lumped_taxon": "Other",
        "percentage": other_percentage,
        "abundance": other_percentage,
    }]







@app.get("/")
def root():
    return {"status": "running"}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "data_source": "postgresql" if using_postgres() else "csv",
        "samples": int(len(df)),
        "taxon_observations": int(len(taxa_df)),
        "publication_links": int(len(dataset_publications_df)),
    }


@app.get("/summary")
def summary():
    return build_summary(df)

@app.get("/correlation")
def correlation(
    x: str,
    y: str,
):

    temp = (
        df[[x, y]]
        .dropna()
        .copy()
    )

    if len(temp) < 2:
        return {
            "correlation": None,
            "p_value": None,
            "n": 0,
        }

    r, p = pearsonr(
        temp[x],
        temp[y]
    )

    return {
        "correlation": float(r),
        "p_value": float(p),
        "n": int(len(temp)),
    }

@app.get("/pca/environment")
def environmental_pca():
    return run_environmental_pca(df)


@app.get("/taxa/lumped")
def taxa_lumped(level: str = "taxon"):
    return compute_taxa_lumping(taxa_df, level)


@app.get("/taxa/top")
def taxa_top(limit: int = 25):
    temp = taxa_df.dropna(
        subset=["taxon_name", "abundance"]
    ).copy()

    result = (
        temp.groupby("taxon_name")["abundance"]
        .sum()
        .reset_index()
        .sort_values("abundance", ascending=False)
        .head(limit)
    )

    return result.to_dict(orient="records")


@app.get("/publication-options")
def publication_options():
    if using_postgres():
        return publication_options_postgres()
    if dataset_publications_df.empty:
        return []

    local_samples = df[["datasetid", "sampleid"]].drop_duplicates()
    options = dataset_publications_df.merge(local_samples, on="datasetid", how="inner")
    options = options.dropna(subset=["publicationid", "citation"])
    options = (
        options.groupby(
            ["publicationid", "citation", "year", "doi"], as_index=False, dropna=False
        )
        .agg(
            sample_count=("sampleid", "nunique"),
            primary_sample_count=(
                "primarypub",
                lambda values: int(pd.Series(values).fillna(False).astype(bool).sum()),
            ),
        )
    )
    options["filter_value"] = options["publicationid"].map(
        lambda value: f"publication:{int(value)}"
    )
    options = options.sort_values(["citation"], key=lambda series: series.str.casefold())
    options = options.astype(object).where(pd.notnull(options), None)
    return options[
        [
            "publicationid",
            "citation",
            "year",
            "doi",
            "filter_value",
            "sample_count",
            "primary_sample_count",
        ]
    ].to_dict(orient="records")

@app.get("/taxa/by-samples")
def taxa_by_samples(sampleids: str, level: str = "taxon", limit: int = 25):
    ids = [
        int(x)
        for x in sampleids.split(",")
        if x.strip().isdigit()
    ]

    temp = taxa_df[
        taxa_df["sampleid"].isin(ids)
    ].copy()

    if temp.empty:
        return []

    result = compute_taxa_lumping(temp, level)
    return limit_taxa_groups(result, max(1, min(limit, 100)))


class TaxaAggregateRequest(BaseModel):
    sampleids: list[int]
    level: str = "taxon"
    limit: int = 25


@app.post("/taxa/aggregate")
def taxa_aggregate(request: TaxaAggregateRequest):
    ids = list(dict.fromkeys(request.sampleids))[:5000]
    if not ids:
        return []

    if using_postgres() and request.level in {"taxon", "species", "finest"}:
        return limit_taxa_groups(
            taxa_aggregate_postgres(ids),
            max(1, min(request.limit, 500)),
        )

    if request.level not in {"taxon", "species", "finest"}:
        selected = taxa_df[taxa_df["sampleid"].isin(ids)]
        return limit_taxa_groups(
            compute_taxa_lumping(selected, request.level),
            max(1, min(request.limit, 500)),
        )

    selected = taxon_profiles_df[taxon_profiles_df["sampleid"].isin(ids)]
    sample_count = selected["sampleid"].nunique()
    if sample_count == 0:
        return []

    result = (
        selected.groupby("lumped_taxon", as_index=False)["percentage"]
        .sum()
        .assign(percentage=lambda frame: frame["percentage"] / sample_count)
        .sort_values("percentage", ascending=False)
    )
    result["abundance"] = result["percentage"]
    return limit_taxa_groups(
        result.to_dict(orient="records"),
        max(1, min(request.limit, 500)),
    )


@app.get("/taxa/composition-by-samples")
def taxa_composition_by_samples(
    sampleids: str,
    level: str = "taxon",
    limit: int = 8,
):
    ids = list(dict.fromkeys(
        int(value)
        for value in sampleids.split(",")
        if value.strip().isdigit()
    ))[:50]
    group_limit = max(2, min(limit, 25))

    if not ids:
        return []

    selected = taxa_df[taxa_df["sampleid"].isin(ids)].copy()
    if selected.empty:
        return []

    records = []
    for sampleid in ids:
        sample = selected[selected["sampleid"] == sampleid]
        if sample.empty:
            continue

        composition = compute_taxa_lumping(sample, level)
        records.append({
            "sampleid": sampleid,
            "composition": limit_taxa_groups(composition, group_limit),
        })

    return records


class SampleProfilesRequest(BaseModel):
    sampleids: list[int]
    level: str = "taxon"
    limit: int = 8


class TaxonValuesRequest(BaseModel):
    sampleids: list[int]
    taxa: list[str]


class CalibrationRequest(BaseModel):
    sampleids: list[int]


@app.post("/taxa/sample-values")
def taxa_sample_values(request: TaxonValuesRequest):
    ids = list(dict.fromkeys(request.sampleids))[:5000]
    taxa = list(dict.fromkeys(name.strip() for name in request.taxa if name.strip()))[:20]
    if not ids or not taxa:
        return []
    if using_postgres():
        return taxon_sample_values_postgres(ids, taxa)
    selected = taxon_profiles_df[
        taxon_profiles_df["sampleid"].isin(ids)
        & taxon_profiles_df["lumped_taxon"].isin(taxa)
    ]
    grouped = {
        int(sampleid): dict(zip(group["lumped_taxon"], group["percentage"]))
        for sampleid, group in selected.groupby("sampleid")
    }
    return [
        {
            "sampleid": sampleid,
            "composition": [
                {"lumped_taxon": taxon, "percentage": float(grouped.get(sampleid, {}).get(taxon, 0))}
                for taxon in taxa
            ],
            "combined_percentage": float(sum(grouped.get(sampleid, {}).get(taxon, 0) for taxon in taxa)),
        }
        for sampleid in ids
    ]


@app.post("/export/taxa-csv")
def export_taxa_csv(request: CalibrationRequest):
    ids = list(dict.fromkeys(request.sampleids))[:5000]
    if using_postgres():
        return StreamingResponse(
            stream_taxa_csv_postgres(ids),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=neotoma_testate_amoebae_filtered_taxa.csv"},
        )
    metadata_columns = [
        "sampleid", "datasetid", "siteid", "sitename", "collectionunit", "handle",
        "pH", "water_table_depth", "water_table_depth_units", "altitude", "doi",
    ]
    metadata = df[df["sampleid"].isin(ids)][
        [column for column in metadata_columns if column in df]
    ].drop_duplicates("sampleid")
    observations = taxa_df[taxa_df["sampleid"].isin(ids)].copy()
    observations["abundance"] = pd.to_numeric(observations["abundance"], errors="coerce")
    observations = observations.dropna(subset=["sampleid", "taxon_name", "abundance"])
    # Pivot to one sample per row for comparison in a spreadsheet; taxa absent
    # from a sample are represented as zero.
    wide_abundance = observations.pivot_table(
        index="sampleid",
        columns="taxon_name",
        values="abundance",
        aggfunc="sum",
        fill_value=0,
    )
    wide_abundance.columns = [f"taxon_{name}_abundance" for name in wide_abundance.columns]
    wide_abundance = wide_abundance.reset_index()
    export = metadata.merge(wide_abundance, on="sampleid", how="left")
    taxon_columns = [column for column in export if column.startswith("taxon_")]
    export[taxon_columns] = export[taxon_columns].fillna(0)
    buffer = io.StringIO()
    export.to_csv(buffer, index=False)
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=neotoma_testate_amoebae_filtered_taxa.csv"},
    )


class AnalogueRequest(BaseModel):
    target_sampleid: int
    calibration_sampleids: list[int]
    limit: int = 10
    exclude_same_site: bool = True
    exclude_same_doi: bool = True


class NmdsRequest(BaseModel):
    sampleids: list[int]
    max_samples: int = 500
    prevalence: float = 0.02
    random_seed: int = 42
    n_init: int = 10
    dimensions: int = 2
    target_sampleid: Optional[int] = None
    run_sensitivity: bool = True


@app.post("/calibration/quality")
def calibration_quality(request: CalibrationRequest):
    ids = list(dict.fromkeys(request.sampleids))[:5000]
    if using_postgres():
        return calibration_quality_postgres(ids)
    selected = df[df["sampleid"].isin(ids)].drop_duplicates("sampleid").copy()
    profiles = taxon_profiles_df[taxon_profiles_df["sampleid"].isin(ids)]
    sample_count = len(selected)
    taxa_ids = set(profiles["sampleid"].astype(int).tolist())
    richness = profiles.groupby("sampleid")["lumped_taxon"].nunique()

    def missing_count(column):
        return int(selected[column].isna().sum()) if column in selected else sample_count

    def numeric_range(column):
        values = pd.to_numeric(selected[column], errors="coerce").dropna()
        if values.empty:
            return {"min": None, "max": None}
        return {"min": float(values.min()), "max": float(values.max())}

    units = []
    if "water_table_depth_units" in selected:
        units = sorted(
            selected["water_table_depth_units"].dropna().astype(str).str.strip().unique().tolist()
        )
    doi_values = selected["doi"].dropna().astype(str).str.split(";").explode().map(normalize_doi)
    doi_values = doi_values.dropna()

    return {
        "sample_count": sample_count,
        "site_count": int(selected["siteid"].nunique()),
        "dataset_count": int(selected["datasetid"].nunique()),
        "samples_with_doi": sample_count - missing_count("doi"),
        "unique_doi_count": int(doi_values.nunique()),
        "taxa_sample_count": len(taxa_ids),
        "missing_taxa": sample_count - len(taxa_ids),
        "missing_ph": missing_count("pH"),
        "missing_water_table": missing_count("water_table_depth"),
        "missing_doi": missing_count("doi"),
        "low_richness_samples": int((richness < 5).sum()),
        "median_taxon_richness": float(richness.median()) if not richness.empty else None,
        "ph_range": numeric_range("pH"),
        "water_table_range": numeric_range("water_table_depth"),
        "water_table_units": units,
    }


@app.post("/calibration/modern-analogues")
def modern_analogues(request: AnalogueRequest):
    candidate_ids = list(dict.fromkeys(request.calibration_sampleids))[:5000]
    candidate_ids = [sampleid for sampleid in candidate_ids if sampleid != request.target_sampleid]
    original_candidate_count = len(candidate_ids)
    sample_metadata = (
        df[df["sampleid"].isin([request.target_sampleid, *candidate_ids])]
        .drop_duplicates("sampleid")
        .set_index("sampleid")
    )
    if request.target_sampleid not in sample_metadata.index:
        return {"error": "The target sample metadata is unavailable.", "matches": []}

    target_metadata = sample_metadata.loc[request.target_sampleid]
    target_siteid = target_metadata.get("siteid")
    target_doi_value = target_metadata.get("doi")
    target_dois = doi_tokens(target_doi_value)

    def retain_candidate(sampleid):
        if sampleid not in sample_metadata.index:
            return False
        candidate = sample_metadata.loc[sampleid]
        if (
            request.exclude_same_site
            and pd.notna(target_siteid)
            and candidate.get("siteid") == target_siteid
        ):
            return False
        if request.exclude_same_doi and target_dois:
            candidate_doi_value = candidate.get("doi")
            candidate_dois = doi_tokens(candidate_doi_value)
            if target_dois.intersection(candidate_dois):
                return False
        return True

    candidate_ids = [sampleid for sampleid in candidate_ids if retain_candidate(sampleid)]
    selected_ids = [request.target_sampleid, *candidate_ids]
    selected = taxon_profiles_df[taxon_profiles_df["sampleid"].isin(selected_ids)]
    if request.target_sampleid not in set(selected["sampleid"].astype(int)):
        return {"error": "The target sample has no usable taxa composition.", "matches": []}

    matrix = selected.pivot_table(
        index="sampleid", columns="lumped_taxon", values="percentage", fill_value=0
    )
    if request.target_sampleid not in matrix.index:
        return {"error": "The target sample has no usable taxa composition.", "matches": []}

    available = [sampleid for sampleid in candidate_ids if sampleid in matrix.index]
    if not available:
        return {"error": "No calibration samples with taxa data are available.", "matches": []}

    target = matrix.loc[request.target_sampleid]
    distances = matrix.loc[available].sub(target, axis="columns").abs().sum(axis=1) / 200
    best = distances.nsmallest(max(1, min(request.limit, 25)))
    metadata = sample_metadata[sample_metadata.index.isin(best.index)]

    def composition_records(values, limit=10):
        return [
            {"lumped_taxon": str(taxon), "percentage": float(percentage)}
            for taxon, percentage in values[values > 0].nlargest(limit).items()
        ]

    matches = []
    for sampleid, distance in best.items():
        candidate = matrix.loc[sampleid]
        shared = pd.concat([target.rename("target"), candidate.rename("candidate")], axis=1)
        shared["minimum"] = shared[["target", "candidate"]].min(axis=1)
        shared_taxa = shared[shared["minimum"] > 0].nlargest(5, "minimum").index.tolist()
        row = metadata.loc[sampleid] if sampleid in metadata.index else None

        def metadata_value(column):
            if row is None or column not in row or pd.isna(row[column]):
                return None
            value = row[column]
            return value.item() if hasattr(value, "item") else value

        target_ph = target_metadata.get("pH")
        target_wtd = target_metadata.get("water_table_depth")
        target_wtd_units = target_metadata.get("water_table_depth_units")
        candidate_ph = metadata_value("pH")
        candidate_wtd = metadata_value("water_table_depth")
        candidate_wtd_units = metadata_value("water_table_depth_units")
        comparable_wtd_units = (
            pd.notna(target_wtd_units)
            and candidate_wtd_units is not None
            and str(target_wtd_units).strip().lower() == str(candidate_wtd_units).strip().lower()
        )
        matches.append({
            "sampleid": int(sampleid),
            "bray_curtis": float(distance),
            "analogue_class": "close" if distance <= 0.2 else "possible" if distance <= 0.4 else "poor",
            "sitename": metadata_value("sitename"),
            "datasetid": metadata_value("datasetid"),
            "doi": metadata_value("doi"),
            "pH": candidate_ph,
            "water_table_depth": candidate_wtd,
            "delta_pH": float(candidate_ph - target_ph) if candidate_ph is not None and pd.notna(target_ph) else None,
            "delta_water_table_depth": float(candidate_wtd - target_wtd) if candidate_wtd is not None and pd.notna(target_wtd) and comparable_wtd_units else None,
            "water_table_depth_units": candidate_wtd_units,
            "shared_taxa": shared_taxa,
            "composition": composition_records(candidate),
        })

    return {
        "target_sampleid": request.target_sampleid,
        "candidate_count": len(available),
        "excluded_candidate_count": original_candidate_count - len(candidate_ids),
        "exclude_same_site": request.exclude_same_site,
        "exclude_same_doi": request.exclude_same_doi,
        "method": "Bray-Curtis dissimilarity on sample-normalized finest-level Neotoma taxon percentages",
        "target_environment": {
            "pH": None if pd.isna(target_metadata.get("pH")) else float(target_metadata.get("pH")),
            "water_table_depth": None if pd.isna(target_metadata.get("water_table_depth")) else float(target_metadata.get("water_table_depth")),
            "water_table_depth_units": None if pd.isna(target_metadata.get("water_table_depth_units")) else target_metadata.get("water_table_depth_units"),
        },
        "target_composition": composition_records(target),
        "matches": matches,
    }


@app.post("/calibration/nmds")
def calibration_nmds(request: NmdsRequest):
    ids = list(dict.fromkeys(request.sampleids))[:5000]
    selected = taxon_profiles_df[taxon_profiles_df["sampleid"].isin(ids)]
    taxa_sample_ids = set(selected["sampleid"].astype(int))
    available_ids = [sampleid for sampleid in ids if sampleid in taxa_sample_ids]
    if len(available_ids) < 3:
        return {"error": "NMDS requires at least three samples with taxa data.", "points": []}

    max_samples = max(3, min(request.max_samples, 1000))
    sampled = len(available_ids) > max_samples
    if sampled:
        rng = np.random.default_rng(request.random_seed)
        site_rows = (
            df[df["sampleid"].isin(available_ids)][["sampleid", "siteid"]]
            .drop_duplicates("sampleid")
        )
        site_for_sample = dict(zip(site_rows["sampleid"].astype(int), site_rows["siteid"]))
        site_groups = {}
        for sampleid in available_ids:
            site = site_for_sample.get(sampleid)
            site_key = str(site) if pd.notna(site) else f"unknown-{sampleid}"
            site_groups.setdefault(site_key, []).append(sampleid)
        group_keys = list(site_groups)
        rng.shuffle(group_keys)
        for group in site_groups.values():
            rng.shuffle(group)
        analysis_ids = []
        depth = 0
        while len(analysis_ids) < max_samples:
            added = False
            for key in group_keys:
                group = site_groups[key]
                if depth < len(group):
                    analysis_ids.append(group[depth])
                    added = True
                    if len(analysis_ids) == max_samples:
                        break
            if not added:
                break
            depth += 1
        if (
            request.target_sampleid in available_ids
            and request.target_sampleid not in analysis_ids
        ):
            analysis_ids[-1] = request.target_sampleid
    else:
        analysis_ids = available_ids

    unfiltered_matrix = (
        selected[selected["sampleid"].isin(analysis_ids)]
        .pivot_table(index="sampleid", columns="lumped_taxon", values="percentage", fill_value=0)
        .reindex(analysis_ids)
    )
    original_taxon_count = unfiltered_matrix.shape[1]

    def prepare_matrix(prevalence):
        minimum_occurrence = max(
            1,
            int(np.ceil(len(unfiltered_matrix) * max(0, min(prevalence, 1)))),
        )
        prepared = unfiltered_matrix.loc[
            :, (unfiltered_matrix > 0).sum(axis=0) >= minimum_occurrence
        ].copy()
        prepared = prepared.loc[prepared.sum(axis=1) > 0]
        # Taxon filtering changes retained totals by different amounts across
        # samples. Restore every retained assemblage to a 100% composition
        # before calculating Bray-Curtis dissimilarities.
        prepared = prepared.div(prepared.sum(axis=1), axis=0) * 100
        return prepared

    matrix = prepare_matrix(request.prevalence)
    if len(matrix) < 3 or matrix.shape[1] < 2:
        return {"error": "Too few samples or taxa remain after prevalence filtering.", "points": []}

    condensed_distances = pdist(matrix.to_numpy(), metric="braycurtis")
    distances = squareform(condensed_distances)
    mds_parameters = inspect.signature(MDS).parameters
    supports_normalized_stress = "normalized_stress" in mds_parameters
    uses_new_mds_api = "metric_mds" in mds_parameters

    def fit_nmds(dimensions, n_init, random_seed):
        options = {
            "n_components": dimensions,
            "random_state": random_seed,
            "n_init": n_init,
            "max_iter": 500,
            "eps": 1e-6,
        }
        if uses_new_mds_api:
            # scikit-learn 1.9+ separates the MDS mode from the distance
            # metric. Supplying every value explicitly also avoids defaults
            # whose behavior is scheduled to change in 1.10.
            options.update({
                "metric_mds": False,
                "metric": "precomputed",
                "init": "random",
            })
        else:
            # Compatibility with the established API used by older deployed
            # environments.
            options.update({
                "metric": False,
                "dissimilarity": "precomputed",
            })
        if supports_normalized_stress:
            options["normalized_stress"] = True
        fitted = MDS(**options)
        fitted_coordinates = fitted.fit_transform(distances)
        if supports_normalized_stress:
            fitted_stress = float(fitted.stress_)
        else:
            denominator = float(np.square(distances).sum())
            fitted_stress = float(np.sqrt(fitted.stress_ / denominator)) if denominator > 0 else 0.0
        return fitted, fitted_coordinates, fitted_stress

    dimensions = 3 if request.dimensions == 3 else 2
    model, coordinates, stress = fit_nmds(
        dimensions,
        max(1, min(request.n_init, 20)),
        request.random_seed,
    )
    comparison_dimension = 3 if dimensions == 2 else 2
    _, _, comparison_stress = fit_nmds(
        comparison_dimension,
        max(1, min(request.n_init, 20)),
        request.random_seed,
    )
    stress_by_dimension = {
        str(dimensions): stress,
        str(comparison_dimension): comparison_stress,
    }
    stress_kind = "normalized Stress-1" if supports_normalized_stress else "approximated normalized stress"

    ordination_distances = pdist(coordinates, metric="euclidean")
    isotonic = IsotonicRegression(increasing=True, out_of_bounds="clip")
    monotonic_disparities = isotonic.fit_transform(
        condensed_distances,
        ordination_distances,
    )
    pair_count = min(2000, len(condensed_distances))
    pair_rng = np.random.default_rng(request.random_seed)
    pair_indexes = (
        np.sort(pair_rng.choice(len(condensed_distances), size=pair_count, replace=False))
        if len(condensed_distances) > pair_count
        else np.arange(len(condensed_distances))
    )

    initialization_sensitivity = []
    prevalence_sensitivity = []
    if request.run_sensitivity:
        for seed in [request.random_seed + 1, request.random_seed + 2]:
            _, alternate_coordinates, alternate_stress = fit_nmds(
                dimensions,
                max(1, min(request.n_init, 20)),
                seed,
            )
            _, _, disparity = procrustes(coordinates, alternate_coordinates)
            initialization_sensitivity.append({
                "random_seed": seed,
                "stress": alternate_stress,
                "procrustes_disparity": float(disparity),
            })

        tested_prevalence = sorted({0.0, float(request.prevalence), 0.05})
        for prevalence in tested_prevalence:
            alternate_matrix = prepare_matrix(prevalence)
            common_ids = matrix.index.intersection(alternate_matrix.index)
            if len(common_ids) < 3 or alternate_matrix.shape[1] < 2:
                correlation = None
            else:
                primary_common_distances = pdist(
                    matrix.loc[common_ids].to_numpy(), metric="braycurtis"
                )
                alternate_distances = pdist(
                    alternate_matrix.loc[common_ids].to_numpy(), metric="braycurtis"
                )
                correlation_value = spearmanr(
                    primary_common_distances,
                    alternate_distances,
                ).statistic
                correlation = (
                    float(correlation_value)
                    if np.isfinite(correlation_value)
                    else None
                )
            prevalence_sensitivity.append({
                "prevalence": prevalence,
                "taxon_count": int(alternate_matrix.shape[1]),
                "sample_count": int(len(common_ids)),
                "distance_spearman": correlation,
            })

    target_id = request.target_sampleid if request.target_sampleid in matrix.index else None
    analogue_ids = set()
    if target_id is not None:
        target_position = matrix.index.get_loc(target_id)
        ranked_positions = np.argsort(distances[target_position])
        ranked_ids = [
            int(matrix.index[position])
            for position in ranked_positions
            if position != target_position
        ]
        analogue_ids = set(ranked_ids[:5])

    metadata = (
        df[df["sampleid"].isin(matrix.index)]
        .drop_duplicates("sampleid")
        .set_index("sampleid")
    )
    dominant = matrix.idxmax(axis=1)
    points = []
    for position, sampleid in enumerate(matrix.index):
        row = metadata.loc[sampleid] if sampleid in metadata.index else None

        def value(column):
            if row is None or column not in row or pd.isna(row[column]):
                return None
            item = row[column]
            return item.item() if hasattr(item, "item") else item

        points.append({
            "sampleid": int(sampleid),
            "nmds1": float(coordinates[position, 0]),
            "nmds2": float(coordinates[position, 1]),
            "nmds3": float(coordinates[position, 2]) if dimensions == 3 else None,
            "sitename": value("sitename"),
            "pH": value("pH"),
            "water_table_depth": value("water_table_depth"),
            "dominant_taxon": str(dominant.loc[sampleid]),
            "highlight": "target" if sampleid == target_id else "analogue" if int(sampleid) in analogue_ids else None,
        })

    return {
        "method": f"{dimensions}D non-metric multidimensional scaling of Bray-Curtis dissimilarities",
        "dimensions": dimensions,
        "stress": stress,
        "stress_kind": stress_kind,
        "iterations": int(getattr(model, "n_iter_", 0)),
        "converged": int(getattr(model, "n_iter_", 500)) < 500,
        "sample_count": len(matrix),
        "taxon_count": matrix.shape[1],
        "removed_taxon_count": original_taxon_count - matrix.shape[1],
        "sampled": sampled,
        "available_sample_count": len(available_ids),
        "prevalence": request.prevalence,
        "random_seed": request.random_seed,
        "n_init": max(1, min(request.n_init, 20)),
        "sampling_method": "site-stratified round-robin" if sampled else "all eligible samples",
        "stress_by_dimension": stress_by_dimension,
        "target_sampleid": target_id,
        "shepard": {
            "bray_curtis": condensed_distances[pair_indexes].astype(float).tolist(),
            "ordination_distance": ordination_distances[pair_indexes].astype(float).tolist(),
            "monotonic_disparity": monotonic_disparities[pair_indexes].astype(float).tolist(),
        },
        "renormalized_after_filtering": True,
        "sensitivity": {
            "initializations": initialization_sensitivity,
            "prevalence": prevalence_sensitivity,
        },
        "points": points,
    }


@app.post("/taxa/sample-profiles")
def taxa_sample_profiles(request: SampleProfilesRequest):
    ids = list(dict.fromkeys(request.sampleids))[:5000]
    group_limit = max(2, min(request.limit, 500))
    selected = (
        taxon_profiles_df[taxon_profiles_df["sampleid"].isin(ids)].copy()
        if request.level in {"taxon", "species", "finest"}
        else taxa_df[taxa_df["sampleid"].isin(ids)].copy()
    )

    if selected.empty:
        return []

    profiles = []
    grouped = {int(sampleid): sample for sampleid, sample in selected.groupby("sampleid")}
    for sampleid in ids:
        sample = grouped.get(sampleid)
        if sample is None:
            continue
        if request.level in {"taxon", "species", "finest"}:
            composition = sample[["lumped_taxon", "percentage"]].to_dict(orient="records")
            for row in composition:
                row["abundance"] = row["percentage"]
            composition = limit_taxa_groups(composition, group_limit)
        else:
            composition = limit_taxa_groups(
                compute_taxa_lumping(sample, request.level),
                group_limit,
            )
        dominant = next(
            (row["lumped_taxon"] for row in composition if row["lumped_taxon"] != "Other"),
            "Unknown",
        )
        profiles.append({
            "sampleid": sampleid,
            "dominant_taxon": dominant,
            "composition": composition,
        })

    return profiles


@app.get("/search")
def search(
    ph_min: Optional[float] = None,
    ph_max: Optional[float] = None,

    water_min: Optional[float] = None,
    water_max: Optional[float] = None,

    lat_min: Optional[float] = None,
    lat_max: Optional[float] = None,

    lon_min: Optional[float] = None,
    lon_max: Optional[float] = None,

    site_contains: Optional[str] = None,
    publication_contains: Optional[str] = None,
):
    publicationid = None
    if publication_contains:
        query = publication_contains.strip()
        if query.startswith("publication:"):
            candidate = query.removeprefix("publication:")
            if not candidate.isdigit():
                return []
            publicationid = int(candidate)

    if using_postgres() and (
        not publication_contains or publicationid is not None
    ):
        records = search_postgres(
            ph_min=ph_min,
            ph_max=ph_max,
            water_min=water_min,
            water_max=water_max,
            lat_min=lat_min,
            lat_max=lat_max,
            lon_min=lon_min,
            lon_max=lon_max,
            site_contains=site_contains,
            publicationid=publicationid,
        )
        print(f"Returning {len(records)} rows from PostgreSQL")
        return records

    result = df.copy()

    if ph_min is not None:
        result = result[result["pH"] >= ph_min]

    if ph_max is not None:
        result = result[result["pH"] <= ph_max]

    if water_min is not None:
        result = result[result["water_table_depth"] >= water_min]

    if water_max is not None:
        result = result[result["water_table_depth"] <= water_max]

    if site_contains:
        result = result[
            result["sitename"].str.contains(
                site_contains,
                case=False,
                na=False,
            )
        ]

    if publication_contains:
        query = publication_contains.strip()
        if query.startswith("publication:"):
            publicationid = query.removeprefix("publication:")
            if publicationid.isdigit():
                matching_dataset_ids = dataset_publications_df.loc[
                    dataset_publications_df["publicationid"].eq(int(publicationid)),
                    "datasetid",
                ]
                result = result[result["datasetid"].isin(matching_dataset_ids)]
            else:
                result = result.iloc[0:0]
        else:
            result = result[
                result["doi"].astype(str).str.contains(query, case=False, na=False)
            ]

    result = result.copy()

    if result.empty:
        return []

    if "geography" in result.columns:
        coords = result["geography"].apply(get_lon_lat)
        result["longitude"] = coords.apply(lambda x: x[0])
        result["latitude"] = coords.apply(lambda x: x[1])
    else:
        result["longitude"] = None
        result["latitude"] = None

    if lat_min is not None:
        result = result[
            result["latitude"] >= lat_min
        ]

    if lat_max is not None:
        result = result[
            result["latitude"] <= lat_max
        ]

    if lon_min is not None:
        result = result[
            result["longitude"] >= lon_min
        ]

    if lon_max is not None:
        result = result[
            result["longitude"] <= lon_max
        ]

    cols = [
        "datasetid",
        "siteid",
        "sitename",
        "sampleid",
        "pH",
        "water_table_depth",
        "altitude",
        "latitude",
        "longitude",
        "doi",
    ]

    cols = [c for c in cols if c in result.columns]

    output = result[cols].head(5000).copy()

    # CRITICAL FIX
    output = output.astype(object)
    output = output.where(pd.notnull(output), None)

    records = output.to_dict(orient="records")

    print(f"Returning {len(records)} rows")

    return records
