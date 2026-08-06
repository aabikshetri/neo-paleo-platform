import json
import time
from pathlib import Path

import pandas as pd
import requests
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://api.neotomadb.org/v2.0"

DATASET_LIST = Path("data/processed/testate_amoebae_surface_sites.csv")
RAW_DIR = Path("data/raw/downloads")
OUT = Path("data/processed/testate_search_index.csv")

RAW_DIR.mkdir(parents=True, exist_ok=True)
OUT.parent.mkdir(parents=True, exist_ok=True)

TARGETS = {
    "ph": "pH",
    "water table depth": "water_table_depth",
}

def fetch_download(datasetid, retries=5):
    cache = RAW_DIR / f"{datasetid}.json"

    if cache.exists():
        return json.loads(cache.read_text())

    url = f"{BASE}/data/downloads/{datasetid}"

    for attempt in range(1, retries + 1):
        try:
            r = requests.get(
                url,
                headers={"User-Agent": "Mozilla/5.0"},
                timeout=90
            )

            if r.status_code == 200:
                js = r.json()
                cache.write_text(json.dumps(js))
                return js

            print(f"{datasetid}: status {r.status_code}, attempt {attempt}")

        except Exception as e:
            print(f"{datasetid}: {e}, attempt {attempt}")

        time.sleep(attempt * 5)

    return None


def extract_from_download(js):
    rows = []

    for item in js.get("data", []):
        site = item.get("site", {})
        cu = site.get("collectionunit", {})
        dataset = cu.get("dataset", site.get("dataset", {}))

        for sample in dataset.get("samples", []):
            row = {
                "datasetid": dataset.get("datasetid"),
                "siteid": site.get("siteid"),
                "sitename": site.get("sitename"),
                "collectionunitid": cu.get("collectionunitid"),
                "collectionunit": cu.get("collectionunit"),
                "handle": cu.get("handle"),
                "datasettype": dataset.get("datasettype"),
                "sampleid": sample.get("sampleid"),
                "samplename": sample.get("samplename"),
                "depth": sample.get("depth"),
                "altitude": site.get("altitude"),
                "geography": site.get("geography"),
                "waterdepth_site": cu.get("waterdepth"),
            }

            for datum in sample.get("datum", []):
                name = str(datum.get("variablename", "")).strip().lower()

                if name in TARGETS:
                    value = datum.get("value")
                    row[TARGETS[name]] = value
                    row[TARGETS[name] + "_units"] = datum.get("units")

            if "pH" in row or "water_table_depth" in row:
                rows.append(row)

    return rows

def process_one_dataset(dsid):
    js = fetch_download(dsid)

    if js is None:
        return dsid, []

    rows = extract_from_download(js)
    return None, rows


def main():
    ids = (
        pd.read_csv(DATASET_LIST)["datasetid"]
        .dropna()
        .astype(int)
        .drop_duplicates()
        .tolist()
    )

    print("datasets:", len(ids))

    all_rows = []
    failed = []

    MAX_WORKERS = 6

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(process_one_dataset, dsid): dsid
            for dsid in ids
        }

        for future in tqdm(as_completed(futures), total=len(futures)):
            failed_id, rows = future.result()

            if failed_id is not None:
                failed.append(failed_id)
            else:
                all_rows.extend(rows)

    df = pd.DataFrame(all_rows)

    for col in ["pH", "water_table_depth", "depth", "waterdepth_site"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df.to_csv(OUT, index=False)

    pd.DataFrame({"datasetid": failed}).to_csv(
        "data/processed/failed_downloads.csv",
        index=False
    )

    print("rows:", len(df))
    print("saved:", OUT)
    print("failed:", len(failed))

    if len(df):
        print(df.head())

        if "pH" in df.columns and "water_table_depth" in df.columns:
            print(df[["pH", "water_table_depth"]].describe())


if __name__ == "__main__":
    main()