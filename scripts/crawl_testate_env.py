import json
import time
from pathlib import Path

import pandas as pd
import requests
from tqdm import tqdm

BASE = "https://api.neotomadb.org/v2.0"

RAW_DIR = Path("data/raw/downloads")
OUT_DIR = Path("data/processed")
RAW_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR.mkdir(parents=True, exist_ok=True)

DATASET_LIST = OUT_DIR / "testate_amoebae_surface_sites.csv"
OUT_FILE = OUT_DIR / "testate_environment_measurements.csv"

TARGETS = {
    "ph": "pH",
    "water table depth": "water_table_depth",
}

def fetch_dataset(datasetid, retries=3):
    raw_file = RAW_DIR / f"dataset_{datasetid}.json"

    if raw_file.exists():
        with open(raw_file, "r") as f:
            return json.load(f)

    url = f"{BASE}/data/downloads/{datasetid}"

    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=60)
            r.raise_for_status()
            js = r.json()

            with open(raw_file, "w") as f:
                json.dump(js, f)

            time.sleep(0.2)
            return js

        except Exception as e:
            print(f"dataset {datasetid} failed attempt {attempt + 1}: {e}")
            time.sleep(3)

    return None


def extract_env(js):
    rows = []

    for item in js.get("data", []):
        site = item.get("site", {})

        siteid = site.get("siteid")
        sitename = site.get("sitename")
        altitude = site.get("altitude")
        geography = site.get("geography")
        geopolitical = site.get("geopolitical")

        cu = site.get("collectionunit", {})
        collectionunitid = cu.get("collectionunitid")
        depositionalenvironment = cu.get("depositionalenvironment")
        location = cu.get("location")
        colldate = cu.get("colldate")

        dataset = cu.get("dataset", site.get("dataset", {}))
        datasetid = dataset.get("datasetid")
        datasetname = dataset.get("datasetname")
        datasettype = dataset.get("datasettype")

        samples = dataset.get("samples", [])

        for sample in samples:
            sample_name = sample.get("samplename")
            sample_id = sample.get("sampleid")

            for datum in sample.get("datum", []):
                var = str(datum.get("variablename", "")).strip().lower()

                if var in TARGETS:
                    rows.append({
                        "siteid": siteid,
                        "sitename": sitename,
                        "altitude": altitude,
                        "geography": geography,
                        "geopolitical": geopolitical,
                        "collectionunitid": collectionunitid,
                        "location": location,
                        "colldate": colldate,
                        "depositionalenvironment": depositionalenvironment,
                        "datasetid": datasetid,
                        "datasetname": datasetname,
                        "datasettype": datasettype,
                        "sampleid": sample_id,
                        "samplename": sample_name,
                        "variable": TARGETS[var],
                        "original_variable": datum.get("variablename"),
                        "value": datum.get("value"),
                        "units": datum.get("units"),
                        "ecologicalgroup": datum.get("ecologicalgroup"),
                        "taxongroup": datum.get("taxongroup"),
                    })

    return rows


def main():
    df_list = pd.read_csv(DATASET_LIST)

    datasetids = (
        df_list["datasetid"]
        .dropna()
        .astype(int)
        .drop_duplicates()
        .tolist()
    )

    print("datasets to crawl:", len(datasetids))

    all_rows = []

    for datasetid in tqdm(datasetids):
        js = fetch_dataset(datasetid)

        if js is None:
            continue

        rows = extract_env(js)
        all_rows.extend(rows)

    out = pd.DataFrame(all_rows)

    out.to_csv(OUT_FILE, index=False)

    print("\nDone")
    print("environment rows:", len(out))

    if len(out):
        print(out.head(20))
        print("\nVariable counts:")
        print(out["variable"].value_counts())

    print("saved:", OUT_FILE)


if __name__ == "__main__":
    main()