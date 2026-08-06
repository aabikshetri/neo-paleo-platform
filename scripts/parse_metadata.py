import json
import pandas as pd
from pathlib import Path

INFILE = Path("data/raw/all_testate_dataset_records.json")
OUTFILE = Path("data/processed/testate_amoebae_surface_sites.csv")
OUTFILE.parent.mkdir(parents=True, exist_ok=True)

with open(INFILE, "r") as f:
    records = json.load(f)

rows = []

for item in records:
    site = item.get("site", {})

    for ds in site.get("datasets", []):
        rows.append({
            "datasetid": ds.get("datasetid"),
            "datasettype": ds.get("datasettype"),
            "datasetname": ds.get("datasetname"),
            "siteid": site.get("siteid"),
            "sitename": site.get("sitename"),
            "collectionunitid": site.get("collectionunitid"),
            "collectionunit": site.get("collectionunit"),
            "handle": site.get("handle"),
            "unittype": site.get("unittype"),
            "geography": site.get("geography"),
            "altitude": site.get("altitude"),
            "doi": ";".join(ds.get("doi", [])) if ds.get("doi") else None,
        })

df = pd.DataFrame(rows).drop_duplicates(subset=["datasetid"])

print(df.head())
print("datasets:", df["datasetid"].nunique())
print("sites:", df["siteid"].nunique())

df.to_csv(OUTFILE, index=False)
print("saved:", OUTFILE)