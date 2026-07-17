import json
from pathlib import Path

import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import numpy as np

from scipy.stats import pearsonr

from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA

BASE_DIR = Path(__file__).resolve().parent

INDEX = (
    BASE_DIR /
    "data" /
    "processed" /
    "testate_search_index.csv"
)


TAXA_INDEX = (
    BASE_DIR /
    "data" /
    "processed" /
    "taxa_abundance.csv"
)

SITES_INDEX = BASE_DIR / "data" / "processed" / "testate_amoebae_surface_sites.csv"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Loading:", INDEX)
print("Exists:", INDEX.exists())

df = pd.read_csv(INDEX)

if SITES_INDEX.exists():
    publication_df = pd.read_csv(SITES_INDEX, usecols=["datasetid", "doi"])
    publication_df = publication_df.drop_duplicates(subset=["datasetid"])
    df = df.merge(publication_df, on="datasetid", how="left")

metadata_json = BASE_DIR.parent / "scripts" / "all_testate_amoebae_surface_samples.json"
if metadata_json.exists():
    try:
        metadata_records = json.loads(metadata_json.read_text())
        investigator_rows = []
        for response in metadata_records:
            for item in response.get("data", []):
                site = item.get("site", {})
                collection_unit = site.get("collectionunit", {})
                datasets = (
                    collection_unit.get("datasets", site.get("datasets", []))
                    if isinstance(collection_unit, dict)
                    else site.get("datasets", [])
                )
                for dataset in datasets:
                    names = [
                        person.get("contactname", "").strip()
                        for person in dataset.get("datasetpi", [])
                        if person.get("contactname")
                    ]
                    investigator_rows.append({
                        "datasetid": dataset.get("datasetid"),
                        "investigators": "; ".join(names),
                    })
        if investigator_rows:
            investigators_df = pd.DataFrame(investigator_rows).drop_duplicates("datasetid")
            df = df.merge(investigators_df, on="datasetid", how="left")
    except (OSError, ValueError, TypeError):
        df["investigators"] = None

if "investigators" not in df.columns:
    df["investigators"] = None

print("Loading taxa:", TAXA_INDEX)
print("Taxa exists:", TAXA_INDEX.exists())

taxa_df = pd.read_csv(TAXA_INDEX)

taxa_df["abundance"] = pd.to_numeric(
    taxa_df["abundance"],
    errors="coerce"
)

for col in ["pH", "water_table_depth", "altitude"]:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")


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


def compute_taxa_lumping(df, level="genus"):
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

    # Several species can lump into the same genus within one sample.
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


def limit_taxa_groups(records, limit):
    if limit is None or limit <= 0 or len(records) <= limit:
        return records

    # Reserve one displayed slice for all genera outside the requested limit.
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
def taxa_lumped(level: str = "genus"):
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
    options = df[["sitename", "doi"]].dropna(subset=["doi"]).copy()
    options["doi"] = options["doi"].astype(str).str.split(";")
    options = options.explode("doi")
    options["doi"] = options["doi"].str.strip().str.lower()
    options = options[options["doi"].ne("")].drop_duplicates(subset=["doi"])
    options = options.sort_values(["sitename", "doi"], na_position="last")
    options = options.astype(object).where(pd.notnull(options), None)
    return options.to_dict(orient="records")

@app.get("/taxa/by-samples")
def taxa_by_samples(sampleids: str, level: str = "genus", limit: int = 25):
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


@app.get("/taxa/composition-by-samples")
def taxa_composition_by_samples(
    sampleids: str,
    level: str = "genus",
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
    level: str = "genus"
    limit: int = 8


@app.post("/taxa/sample-profiles")
def taxa_sample_profiles(request: SampleProfilesRequest):
    ids = list(dict.fromkeys(request.sampleids))[:1000]
    group_limit = max(2, min(request.limit, 100))
    selected = taxa_df[taxa_df["sampleid"].isin(ids)].copy()

    if selected.empty:
        return []

    profiles = []
    grouped = {int(sampleid): sample for sampleid, sample in selected.groupby("sampleid")}
    for sampleid in ids:
        sample = grouped.get(sampleid)
        if sample is None:
            continue
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
            "dominant_genus": dominant,
            "composition": composition,
        })

    return profiles


@app.get("/search")
def search(
    ph_min: float | None = None,
    ph_max: float | None = None,

    water_min: float | None = None,
    water_max: float | None = None,

    lat_min: float | None = None,
    lat_max: float | None = None,

    lon_min: float | None = None,
    lon_max: float | None = None,

    site_contains: str | None = None,
    publication_contains: str | None = None,
):

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
        "collectionunit",
        "handle",
        "sampleid",
        "pH",
        "water_table_depth",
        "water_table_depth_units",
        "altitude",
        "latitude",
        "longitude",
        "doi",
        "investigators",
    ]

    cols = [c for c in cols if c in result.columns]

    output = result[cols].head(5000).copy()

    # CRITICAL FIX
    output = output.astype(object)
    output = output.where(pd.notnull(output), None)

    records = output.to_dict(orient="records")

    print(f"Returning {len(records)} rows")

    return records
