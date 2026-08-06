import json
from pathlib import Path

import pandas as pd
from tqdm import tqdm

RAW_DIR = Path("data/raw/downloads")
OUT = Path("data/processed/testate_search_index_partial.csv")
OUT.parent.mkdir(parents=True, exist_ok=True)

rows = []

json_files = list(RAW_DIR.glob("*.json"))

print("json files found:", len(json_files))

for path in tqdm(json_files):
    js = json.loads(path.read_text())

    for item in js.get("data", []):
        site = item.get("site", {})
        cu = site.get("collectionunit", {})
        dataset = cu.get("dataset", site.get("dataset", {}))

        for sample in dataset.get("samples", []):
            row = {
                "datasetid": dataset.get("datasetid"),
                "siteid": site.get("siteid"),
                "sitename": site.get("sitename"),
                "collectionunit": cu.get("collectionunit"),
                "handle": cu.get("handle"),
                "sampleid": sample.get("sampleid"),
                "geography": site.get("geography"),
                "altitude": site.get("altitude"),
            }

            for datum in sample.get("datum", []):
                name = str(datum.get("variablename", "")).strip().lower()

                if name == "ph":
                    row["pH"] = datum.get("value")

                elif name == "water table depth":
                    row["water_table_depth"] = datum.get("value")
                    row["water_table_depth_units"] = datum.get("units")

            if "pH" in row or "water_table_depth" in row:
                rows.append(row)

df = pd.DataFrame(rows)

for col in ["pH", "water_table_depth", "altitude"]:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")

df.to_csv(OUT, index=False)

print("rows:", len(df))
print("saved:", OUT)

if len(df):
    print(df.head())
    print(df[["pH", "water_table_depth"]].describe())

    result = df[
        (df["pH"] < 5) &
        (df["water_table_depth"] > 10)
    ]

    print("\nMatches for pH < 5 and water_table_depth > 10:", len(result))
    print(result[[
        "datasetid",
        "siteid",
        "sitename",
        "collectionunit",
        "pH",
        "water_table_depth"
    ]].head(30))