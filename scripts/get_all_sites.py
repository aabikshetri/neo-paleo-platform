import requests
import json
import time
from pathlib import Path

BASE = "https://api.neotomadb.org/v2.0"

OUT = Path("data/raw")
OUT.mkdir(parents=True, exist_ok=True)

all_records = []
limit = 500
offset = 0

while True:
    print(f"Fetching offset={offset}")

    r = requests.get(
        f"{BASE}/data/datasets",
        params={
            "datasettype": "testate amoebae surface sample",
            "limit": limit,
            "offset": offset,
        },
        timeout=90,
        headers={"User-Agent": "Mozilla/5.0"},
    )

    print("status:", r.status_code)

    if r.status_code != 200:
        print(r.text[:500])
        time.sleep(5)
        continue

    js = r.json()
    batch = js.get("data", [])

    print("batch size:", len(batch))

    if not batch:
        break

    all_records.extend(batch)

    if len(batch) < limit:
        break

    offset += limit
    time.sleep(0.5)

out_file = OUT / "all_testate_dataset_records.json"

with open(out_file, "w") as f:
    json.dump(all_records, f, indent=2)

print("saved:", out_file)
print("total records:", len(all_records))

if all_records:
    print("first record:")
    print(json.dumps(all_records[0], indent=2)[:5000])