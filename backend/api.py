import json
from pathlib import Path

import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

    result = result.copy()

    result[["longitude", "latitude"]] = (
        result["geography"]
        .apply(lambda g: pd.Series(get_lon_lat(g)))
    )

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
    ]

    cols = [c for c in cols if c in result.columns]

    output = result[cols].head(5000).copy()

    # CRITICAL FIX
    output = output.astype(object)
    output = output.where(pd.notnull(output), None)

    records = output.to_dict(orient="records")

    print(f"Returning {len(records)} rows")

    return records