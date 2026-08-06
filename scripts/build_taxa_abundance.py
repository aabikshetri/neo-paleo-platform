from pathlib import Path
import json
import pandas as pd

RAW_DIR = Path("/Users/aabiskar/Desktop/raw/downloads")
OUT = Path("/Users/aabiskar/Desktop/Neo/backend/data/processed/taxa_abundance.csv")

OUT.parent.mkdir(parents=True, exist_ok=True)

rows = []

json_files = list(RAW_DIR.glob("*.json"))

print("JSON files found:", len(json_files))

for i, path in enumerate(json_files):
    try:
        with open(path, "r") as f:
            js = json.load(f)

        for item in js.get("data", []):
            site = item.get("site", {})
            cu = site.get("collectionunit", {})
            dataset = cu.get("dataset", site.get("dataset", {}))

            for sample in dataset.get("samples", []):
                for datum in sample.get("datum", []):
                    if datum.get("taxongroup") != "Testate amoebae":
                        continue

                    rows.append({
                        "datasetid": dataset.get("datasetid"),
                        "siteid": site.get("siteid"),
                        "sitename": site.get("sitename"),
                        "collectionunitid": cu.get("collectionunitid"),
                        "handle": cu.get("handle"),
                        "sampleid": sample.get("sampleid"),
                        "depth": sample.get("depth"),
                        "taxonid": datum.get("taxonid"),
                        "taxon_name": datum.get("variablename"),
                        "abundance": datum.get("value"),
                        "units": datum.get("units"),
                        "taxongroup": datum.get("taxongroup"),
                        "ecologicalgroup": datum.get("ecologicalgroup"),
                        "geography": site.get("geography"),
                        "altitude": site.get("altitude"),
                    })

        if i % 100 == 0:
            print("processed:", i)

    except Exception as e:
        print("failed:", path.name, e)

df = pd.DataFrame(rows)

if df.empty:
    print("No taxa rows found.")
    raise SystemExit(0)

df["abundance"] = pd.to_numeric(df["abundance"], errors="coerce")
df = df.dropna(subset=["sampleid", "taxon_name", "abundance"])

df.to_csv(OUT, index=False)

print("saved:", OUT)
print("rows:", len(df))
print("unique samples:", df["sampleid"].nunique())
print("unique taxa:", df["taxon_name"].nunique())
print(df.head())