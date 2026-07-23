"""Build a cached Neotoma publication index for the datasets used by Neo."""

from pathlib import Path
import json
from urllib.request import Request, urlopen

import pandas as pd


API_BASE = "https://api.neotomadb.org/v2.0/data/dbtables"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
SEARCH_INDEX = PROJECT_ROOT / "backend/data/processed/testate_search_index.csv"
OUTPUT = PROJECT_ROOT / "backend/data/processed/dataset_publications.csv"


def fetch_table(name: str, page_size: int = 5000) -> pd.DataFrame:
    rows = []
    offset = 0
    while True:
        request = Request(
            f"{API_BASE}/{name}?limit={page_size}&offset={offset}",
            headers={"User-Agent": "Neo publication-index builder"},
        )
        with urlopen(request, timeout=180) as response:
            payload = json.load(response)
        page = payload.get("data")
        if payload.get("status") != "success" or not isinstance(page, list):
            raise RuntimeError(f"Unexpected Neotoma response for {name}")
        rows.extend(page)
        print(f"{name}: downloaded {len(rows):,} rows")
        if len(page) < page_size:
            break
        offset += len(page)
    return pd.DataFrame(rows)


def main() -> None:
    local_dataset_ids = set(
        pd.read_csv(SEARCH_INDEX, usecols=["datasetid"])["datasetid"]
        .dropna()
        .astype(int)
        .unique()
    )
    print(f"Local datasets: {len(local_dataset_ids):,}")

    relationships = fetch_table("datasetpublications")
    relationships["datasetid"] = pd.to_numeric(
        relationships["datasetid"], errors="coerce"
    )
    relationships = relationships[
        relationships["datasetid"].isin(local_dataset_ids)
    ].copy()
    relationships["datasetid"] = relationships["datasetid"].astype(int)
    relationships["publicationid"] = relationships["publicationid"].astype(int)
    print(f"Local dataset-publication links: {len(relationships):,}")

    publications = fetch_table("publications")
    publication_columns = [
        "publicationid",
        "pubtype",
        "year",
        "citation",
        "articletitle",
        "journal",
        "volume",
        "issue",
        "pages",
        "doi",
        "url",
    ]
    publications = publications[
        [column for column in publication_columns if column in publications]
    ].copy()
    publications["publicationid"] = publications["publicationid"].astype(int)

    result = relationships[
        ["datasetid", "publicationid", "primarypub"]
    ].merge(publications, on="publicationid", how="left")
    result = result.sort_values(
        ["citation", "publicationid", "datasetid"], na_position="last"
    )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(OUTPUT, index=False)

    print(f"Unique publications: {result['publicationid'].nunique():,}")
    print(f"Datasets with publications: {result['datasetid'].nunique():,}")
    print(f"Saved: {OUTPUT}")


if __name__ == "__main__":
    main()
