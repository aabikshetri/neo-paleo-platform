"""Process-local runtime frames shared by API services and routers."""

import numpy as np
import pandas as pd

from backend.repositories.runtime_data import load_runtime_frames
from backend.services.scientific import build_taxon_profiles


df, taxa_df, dataset_publications_df = load_runtime_frames()

dataset_publications_df["datasetid"] = pd.to_numeric(
    dataset_publications_df["datasetid"], errors="coerce"
).astype("Int64")
dataset_publications_df["publicationid"] = pd.to_numeric(
    dataset_publications_df["publicationid"], errors="coerce"
).astype("Int64")
taxa_df["abundance"] = pd.to_numeric(taxa_df["abundance"], errors="coerce")

for column in ["pH", "water_table_depth", "altitude"]:
    if column in df.columns:
        df[column] = pd.to_numeric(df[column], errors="coerce")

if "pH" in df.columns:
    df.loc[(df["pH"] < 0) | (df["pH"] > 14), "pH"] = np.nan
if "water_table_depth" in df.columns:
    df.loc[df["water_table_depth"] <= -90, "water_table_depth"] = np.nan

taxon_profiles_df = build_taxon_profiles(taxa_df)
