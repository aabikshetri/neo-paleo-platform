"""Pure scientific/data transformations with no HTTP or database dependencies."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler


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


def get_lon_lat(geo):
    try:
        geometry = json.loads(geo)
        if geometry["type"] == "Point":
            longitude, latitude = geometry["coordinates"]
            return longitude, latitude
        if geometry["type"] == "Polygon":
            ring = geometry["coordinates"][0]
            longitude = sum(point[0] for point in ring) / len(ring)
            latitude = sum(point[1] for point in ring) / len(ring)
            return longitude, latitude
    except Exception:
        pass
    return None, None


def build_summary(frame):
    return {
        "samples": int(len(frame)),
        "sites": int(frame["siteid"].nunique()),
        "mean_ph": round(frame["pH"].dropna().mean(), 2),
        "mean_water_table": round(frame["water_table_depth"].dropna().mean(), 2),
        "mean_altitude": round(frame["altitude"].dropna().mean(), 2),
    }


def run_environmental_pca(frame):
    columns = ["pH", "water_table_depth", "altitude"]
    complete = frame[columns].dropna().copy()
    if len(complete) < 3:
        return {"pc1": [], "pc2": [], "explained_variance": []}
    scaled = StandardScaler().fit_transform(complete)
    pca = PCA(n_components=2)
    coordinates = pca.fit_transform(scaled)
    return {
        "pc1": coordinates[:, 0].tolist(),
        "pc2": coordinates[:, 1].tolist(),
        "explained_variance": pca.explained_variance_ratio_.tolist(),
        "samples": len(complete),
        "variables": columns,
    }


def lump_taxon_name(name: str, level: str = "genus"):
    if not isinstance(name, str):
        return "Unknown"
    name = name.strip()
    if not name:
        return "Unknown"
    return name.split()[0] if level == "genus" else name


def build_taxon_profiles(source):
    """Normalize once per sample at Neotoma's finest recorded taxon level."""
    temp = source[["sampleid", "taxon_name", "abundance"]].copy()
    temp["abundance"] = pd.to_numeric(temp["abundance"], errors="coerce")
    temp = temp.dropna(subset=["sampleid", "taxon_name", "abundance"])
    temp = temp[temp["abundance"] > 0]
    temp["lumped_taxon"] = temp["taxon_name"].apply(
        lambda value: lump_taxon_name(value, "taxon")
    )
    totals = temp.groupby("sampleid")["abundance"].transform("sum")
    temp["percentage"] = temp["abundance"] / totals * 100
    return (
        temp.groupby(["sampleid", "lumped_taxon"], as_index=False)["percentage"]
        .sum()
        .sort_values(["sampleid", "percentage"], ascending=[True, False])
    )


def limit_taxa_groups(records, limit):
    if limit is None or limit <= 0 or len(records) <= limit:
        return records
    kept = records[: max(limit - 1, 0)]
    remainder = records[max(limit - 1, 0):]
    other_percentage = sum(row["percentage"] for row in remainder)
    return kept + [{
        "lumped_taxon": "Other",
        "percentage": other_percentage,
        "abundance": other_percentage,
    }]
