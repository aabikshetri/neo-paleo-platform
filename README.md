# AmoebaScope — Neotoma Testate Amoeba Database Explorer

AmoebaScope is a web application for exploring testate amoeba surface-sample and
paleoecological data from the Neotoma Paleoecology Database.

The application supports:

- Filtering samples by site, publication attribution, pH, water-table depth,
  latitude, and longitude
- Downloading filtered abundance data as a wide CSV with one row per sample
- Exploring geographic and environmental distributions
- Comparing multiple taxa along environmental gradients
- Calculating percentage-weighted taxon optima for pH or water-table depth
- Reviewing data coverage and running exploratory community analyses

## First-time setup: start here

This guide runs the complete application locally with PostgreSQL. PostgreSQL,
the FastAPI backend, and the React frontend are separate services. Complete
steps 1–5 once, then use three terminal windows for steps 6–8.

### 1. Install and check the prerequisites

Install:

- [Git](https://git-scm.com/)
- [Python](https://www.python.org/downloads/) 3.9 or newer
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- npm (installed with [Node.js](https://nodejs.org/))

Confirm the command-line tools are available:

```bash
git --version
python3 --version
docker --version
npm --version
```

The frontend requires Node 20.19+ or 22.12+. The project npm scripts request a
temporary Node 22 runtime automatically, so an older system Node can still be
used if the computer has internet access.

### 2. Clone the project from GitHub

The following commands place the project in the current user's home directory:

```bash
cd ~
git clone https://github.com/aabikshetri/neo-paleo-platform.git
cd neo-paleo-platform
```

Confirm that Git cloned the correct repository:

```bash
git remote -v
git status
```

The remote should contain `aabikshetri/neo-paleo-platform`, and the working tree
should initially be clean. If the project was already cloned, update it with:

```bash
cd ~/neo-paleo-platform
git pull --ff-only origin main
```

All backend and Docker commands below are run from this repository root unless
another directory is shown.

Before installing anything, verify that the processed runtime datasets were
included in the clone:

```bash
ls backend/data/processed/testate_search_index.csv \
   backend/data/processed/taxa_abundance.csv \
   backend/data/processed/testate_amoebae_surface_sites.csv \
   backend/data/processed/dataset_publications.csv
```

All four files are tracked in this repository and are required by the initial
PostgreSQL import. If any are missing, confirm that the clone completed and run
`git pull --ff-only origin main` before continuing.

### 3. Create the Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt
```

On future runs, do not recreate the environment. Activate it with:

```bash
source .venv/bin/activate
```

### 4. Install the frontend dependencies

```bash
cd frontend
npm install --include=optional
cd ..
```

This only needs to be repeated when `frontend/package.json` or the lockfile
changes.

Build the frontend once to verify that Node, TypeScript, Vite, and all frontend
dependencies work on the new device:

```bash
cd frontend
npm run build
cd ..
```

A successful build creates `frontend/dist/`. That directory is generated and
does not need to be committed. If Vite reports an unsupported Node version,
confirm that the device has internet access; the project script obtains a
compatible Node 22 runtime automatically.

### 5. Create and populate PostgreSQL

Start Docker Desktop. On macOS it can be opened from Finder, or with:

```bash
open -a Docker
```

Wait until Docker Desktop reports that its engine is running, then start the
database:

```bash
docker compose up -d postgres
docker compose ps
```

The `postgres` service should display `Up` and eventually `healthy`. Import the
processed Neotoma-derived runtime data:

```bash
source .venv/bin/activate

DATABASE_URL=postgresql://neo:neo-development@127.0.0.1:5433/neo \
python scripts/import_runtime_data.py
```

A successful first import reports approximately:

```text
Imported 4,389 samples
Imported 65,042 taxon observations
Imported 45 publications
Imported 6,326 publication links
```

The import creates AmoebaScope's own optimized PostgreSQL tables. It does not
modify the live Neotoma database. The import only needs to be rerun when the
processed source data or database schema changes.

### 6. Terminal 1: keep PostgreSQL running

PostgreSQL is already running after step 5. On later sessions, start it with:

```bash
cd ~/neo-paleo-platform
docker compose up -d postgres
```

Docker runs PostgreSQL in the background, so this terminal does not have to
remain busy.

### 7. Terminal 2: start the backend

Open a new terminal:

```bash
cd ~/neo-paleo-platform
source .venv/bin/activate

DATABASE_URL=postgresql://neo:neo-development@127.0.0.1:5433/neo \
python -m uvicorn backend.api:app \
  --host 127.0.0.1 \
  --port 8001 \
  --reload
```

Keep this terminal open. The backend is ready when it says `Application startup
complete`. In another terminal, verify it:

```bash
curl http://127.0.0.1:8001/health
```

The response must contain `"data_source":"postgresql"`. If it says `csv`, stop
the backend with `Ctrl+C` and restart it using the complete command above,
including `DATABASE_URL=...`.

### 8. Terminal 3: start the frontend

Open another terminal:

```bash
cd ~/neo-paleo-platform/frontend

VITE_API_URL=http://127.0.0.1:8001 \
npm run dev -- --host 127.0.0.1 --port 5173
```

Keep this terminal open and visit:

<http://127.0.0.1:5173>

The terminal addresses have different purposes:

- `127.0.0.1:5433` — PostgreSQL database
- `127.0.0.1:8001` — FastAPI backend and API documentation
- `127.0.0.1:5173` — AmoebaScope website

Interactive backend documentation is available at:

<http://127.0.0.1:8001/docs>

### 9. Confirm the application works

After opening the website:

1. Confirm that the sample count is approximately 4,389 before filtering.
2. Select a publication or environmental range and click the filter/search
   control.
3. Open **Exploratory visualization** to load the geographic, environmental,
   multi-taxon, and univariate plots.
4. Click a scatter point or map marker to display its site information.
5. Select one or more taxa to inspect their abundances and weighted optimum.
6. Click **Download CSV** and confirm that each sample occupies one row and taxa
   are abundance columns.

### 10. Check a production frontend build

The development server is sufficient for local use. Before deployment, verify
that the optimized frontend builds successfully:

```bash
cd ~/neo-paleo-platform/frontend
npm run build
```

The generated static application is written to `frontend/dist/`. Building the
frontend does not deploy the backend or PostgreSQL database.

### 11. Stop the application safely

Press `Ctrl+C` in the frontend terminal, then in the backend terminal. Stop
PostgreSQL without deleting the imported data:

```bash
cd ~/neo-paleo-platform
docker compose stop postgres
```

Do not run `docker compose down -v` unless you intentionally want to delete the
PostgreSQL volume and perform the import again.

### Normal startup after the first installation

You only need these three commands on later runs:

```bash
# Terminal 1 — PostgreSQL
cd ~/neo-paleo-platform
docker compose up -d postgres
```

```bash
# Terminal 2 — backend
cd ~/neo-paleo-platform
source .venv/bin/activate
DATABASE_URL=postgresql://neo:neo-development@127.0.0.1:5433/neo \
python -m uvicorn backend.api:app --host 127.0.0.1 --port 8001 --reload
```

```bash
# Terminal 3 — frontend
cd ~/neo-paleo-platform/frontend
VITE_API_URL=http://127.0.0.1:8001 \
npm run dev -- --host 127.0.0.1 --port 5173
```

## Current implementation status

The PostgreSQL workflow has been initialized and verified locally with:

```text
4,389 samples
65,042 relevant taxon observations
45 publications
6,326 dataset-publication relationships
```

The backend health endpoint confirms whether a running instance is using
PostgreSQL or the migration fallback:

```bash
curl http://127.0.0.1:8001/health
```

Expected PostgreSQL response:

```json
{
  "status": "ok",
  "data_source": "postgresql",
  "samples": 4389,
  "taxon_observations": 65042,
  "publication_links": 6326
}
```

## How the platform works

Neo is a read-oriented data explorer. It does not modify the live Neotoma
database. Processed extracts are imported into Neo's PostgreSQL database so
searches and visualizations remain fast and reproducible.

```mermaid
flowchart LR
    N["Neotoma API and database"] --> S["Data-build scripts"]
    S --> C["Processed CSV files"]
    C --> I["Transactional importer"]
    I --> P["Neo PostgreSQL"]
    P --> B["FastAPI backend"]
    B --> F["React frontend"]
    F --> U["Researcher"]
```

The CSV-to-backend path remains available only as a deliberate fallback when
`DATABASE_URL` is not configured.

### 1. Data acquisition and processing

Scripts in `scripts/` retrieve or process Neotoma records. The important
runtime datasets are stored in `backend/data/processed/`:

- `testate_search_index.csv` — one searchable row per surface sample, including
  environmental and geographic metadata
- `taxa_abundance.csv` — taxon observations and recorded abundances
- `testate_amoebae_surface_sites.csv` — site, dataset, and dataset DOI metadata
- `dataset_publications.csv` — authoritative Neotoma publication-to-dataset
  relationships and full citations

The publication index is generated from Neotoma's `datasetpublications` and
`publications` tables. A dataset can be connected to multiple papers, and the
cache preserves Neotoma's primary-publication flag.

### 2. Backend API

`backend/api.py` connects to PostgreSQL when `DATABASE_URL` is present.
PostgreSQL performs indexed sample and publication filtering. The backend also
loads the records needed by the current scientific calculations into Pandas
when FastAPI starts. It provides endpoints for:

- Searching and filtering samples
- Returning publication options
- Aggregating taxon composition
- Returning per-sample taxon profiles
- Producing a wide CSV download
- Calculating data-coverage statistics
- Running modern-analogue and NMDS analyses

Publication filtering uses Neotoma publication IDs internally. Selecting a
paper finds every local dataset associated with that publication and then
returns its samples.

The CSV export pivots observations from long format to wide format:

```text
sampleid | site metadata | taxon_A_abundance | taxon_B_abundance | ...
```

Each sample appears once. Taxa not recorded in a sample are represented by
zero.

### 3. Frontend application

The React frontend calls the FastAPI backend through `VITE_API_URL`. It renders:

- Sample and environmental filters
- Full publication citations
- Geographic and environmental plots
- Multi-taxon abundance plots
- A combined-taxon univariate response plot
- Percentage-weighted pH or water-table-depth optima
- Site/sample information and data-coverage summaries

Changing filters updates the active sample IDs. Those IDs are then reused by
the plots, statistics, analyses, and CSV export so every section represents the
same filtered dataset.

### 4. Weighted environmental optimum

For selected taxa, Neo calculates a simple weighted-average optimum:

```text
optimum = sum(environmental value × taxon percentage)
          / sum(taxon percentage)
```

For a combined selection, the percentages of the selected taxa are summed
within each sample before the optimum is calculated.

## PostgreSQL and processed files

Neo now supports PostgreSQL through `DATABASE_URL`. When that variable is set,
the backend loads its runtime samples, taxa, and publication relationships from
PostgreSQL. When it is absent, Neo falls back to the processed CSV files.

This staged design keeps local scientific workflows reproducible while making a
shared production database possible. The processed-file design remains
appropriate when:

- The application is primarily read-only
- The dataset is small enough to load into backend memory
- Data updates happen as deliberate, versioned refreshes
- A single backend instance serves a modest number of users
- Reproducibility is more important than real-time synchronization

For the current Testate Amoebae surface-sample collection, CSV-backed operation
is still useful for development, data refreshes, and reproducibility.

An application database becomes worthwhile when Neo needs:

- Frequent or automatic synchronization with Neotoma
- User accounts, saved filters, projects, or annotations
- Concurrent data editing
- Larger datasets that should not be loaded fully into memory
- Faster indexed queries under substantial traffic
- Audit history, permissions, or administrative workflows
- Multiple backend instances sharing the same state

PostgreSQL is now implemented as a synchronized analytical/application
database, not as a replacement for Neotoma. Neotoma remains the authoritative
source for samples, taxa, datasets, and publication relationships.

The implemented normalized schema contains:

```text
samples
taxon_abundances
sample_taxon_profiles
publications
dataset_publications
data_refreshes
```

Every imported record should retain its Neotoma identifier, source URL or
endpoint, and refresh timestamp. That preserves provenance and makes updates
repeatable.

### Recommended path

1. Use PostgreSQL for shared and production backend deployments.
2. Keep the processed CSVs as versioned import inputs until the Neotoma refresh
   pipeline writes directly to PostgreSQL.
3. Automate and test the Neotoma refresh scripts.
4. Move high-traffic filters and aggregations from Pandas into SQL incrementally.
5. Keep processed exports available for reproducibility.

Publication filters use Neotoma's authoritative dataset-to-publication
relationships and full citations. The cached index can be refreshed from the
live Neotoma database with:

```bash
cd /Users/aabiskar/Desktop/Neo
source .venv/bin/activate
python scripts/build_publication_index.py
```

This refresh requires internet access but is not required each time the app
starts.

## Project structure

```text
Neo/
├── docker-compose.yml       Local PostgreSQL 16 service
├── .env.example             Example database connection
├── backend/                 FastAPI application and processed data
│   ├── api.py
│   ├── database.py
│   ├── schema.sql
│   ├── requirements.txt
│   └── data/processed/
├── frontend/                React, TypeScript, and Vite application
│   ├── src/
│   └── package.json
└── scripts/                 Data collection and processing scripts
```

The frontend and backend run as separate local processes:

- Backend API: `http://127.0.0.1:8001`
- Frontend: `http://127.0.0.1:5173`

In production, the frontend can be hosted by Vercel, but it still requires a
publicly reachable backend API. `VITE_API_URL` must point to that deployed
backend during the production build; `127.0.0.1` works only for local
development.

## Prerequisites

- Python 3.9 or newer
- npm
- Internet access the first time the frontend requests its Node 22 runtime

The frontend requires Node 20.19+ or Node 22.12+. Its npm scripts automatically
run Vite with Node 22, so the project can still start when an older system Node
version is first on your `PATH`.

## First-time backend setup

From the repository root:

```bash
cd /Users/aabiskar/Desktop/Neo

python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

If `.venv` already exists, only activate it:

```bash
cd /Users/aabiskar/Desktop/Neo
source .venv/bin/activate
```

## First-time frontend setup

```bash
cd /Users/aabiskar/Desktop/Neo/frontend
npm install
```

## PostgreSQL setup

The local database uses port `5433` so it does not conflict with a PostgreSQL
installation using the default port `5432`.

Start Docker Desktop, then run:

```bash
cd /Users/aabiskar/Desktop/Neo
docker compose up -d postgres
```

Set the connection string in the terminal:

```bash
export DATABASE_URL=postgresql://neo:neo-development@127.0.0.1:5433/neo
```

Import the processed runtime data:

```bash
source .venv/bin/activate
python scripts/import_runtime_data.py
```

The importer stores abundance rows only for sample IDs present in
`testate_search_index.csv`. Observations outside Neo's searchable runtime
dataset are intentionally not copied into PostgreSQL.

The import creates and populates:

- `samples`
- `taxon_abundances`
- `sample_taxon_profiles` (sample-normalized percentages used by interactive analyses)
- `publications`
- `dataset_publications`
- `data_refreshes`

The importer replaces the five runtime data tables inside a transaction. The
named Docker volume `neo_postgres_data` preserves PostgreSQL data when the
container is stopped or recreated.

The importer is safe to rerun after rebuilding the processed source files. A
failed import is rolled back instead of leaving partially replaced runtime
tables.

The backend uses a process-local PostgreSQL connection pool and a bounded,
refresh-aware query cache. Defaults can be adjusted with
`DATABASE_POOL_SIZE`, `DATABASE_CACHE_SIZE`, and
`DATABASE_CACHE_TTL_SECONDS`. Cache entries automatically use the latest
`data_refreshes.refreshid`, so a completed import starts a new cache generation.

Large sample responses are compressed with GZip. Taxon aggregation, per-sample
taxon values, and data-coverage calculations execute in indexed SQL using the
precomputed `sample_taxon_profiles` table. The SQL normalization retains only
positive abundances, normalizes each sample to 100%, and combines duplicate
recorded taxon names—the same scientific rules as the original Pandas path.

Wide CSV downloads are streamed one sample row at a time when PostgreSQL is
active. Large two-dimensional plots use Plotly WebGL traces, and expensive
taxon requests are deferred until their visualization section is opened.

Verify the container:

```bash
docker compose ps
```

After the import, you may run the backend on the host as documented below, or
run the database-backed backend container:

```bash
docker compose up -d backend
```

The production backend image contains application code only. Processed CSVs,
raw scripts, and frontend assets are excluded from the image.

Stop it without deleting its data:

```bash
docker compose stop postgres
```

For a managed production database, replace the local connection string with the
provider's PostgreSQL URL. Use TLS settings required by that provider and store
the URL as a secret environment variable; never commit it.

## Running the application with PostgreSQL

Run the services in this order: PostgreSQL, backend, then frontend. Use three
terminal tabs or windows. PostgreSQL runs in Docker in the background, while
the backend and frontend terminals must remain open.

### Terminal 1: start PostgreSQL

Make sure Docker Desktop is running, then start the database container:

```bash
cd /Users/aabiskar/Desktop/Neo
docker compose up -d postgres
docker compose ps
```

The `postgres` service should be listed as running (and eventually healthy).
The application database is exposed locally on port `5433`.

You only need to import the processed data the first time you create the
database, or after the processed source files change. To perform that import:

```bash
cd /Users/aabiskar/Desktop/Neo
source .venv/bin/activate

export DATABASE_URL=postgresql://neo:neo-development@127.0.0.1:5433/neo
python scripts/import_runtime_data.py
```

Do not run the importer during every application startup. Docker's named volume
preserves the imported database between normal container stops and restarts.

### Terminal 2: start the backend

```bash
cd /Users/aabiskar/Desktop/Neo
source .venv/bin/activate

DATABASE_URL=postgresql://neo:neo-development@127.0.0.1:5433/neo \
python -m uvicorn backend.api:app \
  --host 127.0.0.1 \
  --port 8001 \
  --reload
```

The backend is ready when the terminal displays:

```text
Application startup complete.
Uvicorn running on http://127.0.0.1:8001
```

Using `DATABASE_URL=...` in the same command is important: environment
variables set in another terminal are not automatically available here.

While the backend remains running, verify it from another terminal:

```bash
curl http://127.0.0.1:8001/health
```

The response should contain:

```json
{
  "status": "ok",
  "data_source": "postgresql",
  "samples": 4389,
  "taxon_observations": 65042,
  "publication_links": 6326
}
```

If `data_source` says `csv`, stop the backend with `Ctrl+C` and restart it with
the complete `DATABASE_URL=... python -m uvicorn ...` command above.

To intentionally use the CSV fallback instead, omit or unset `DATABASE_URL`:

```bash
unset DATABASE_URL
```

### Terminal 3: start the frontend

```bash
cd /Users/aabiskar/Desktop/Neo/frontend

VITE_API_URL=http://127.0.0.1:8001 \
npm run dev -- --host 127.0.0.1 --port 5173
```

The frontend npm script automatically launches Vite with Node 22. The frontend
is ready when the terminal displays a local URL for port `5173`.

Open the application at:

<http://127.0.0.1:5173>

### Quick startup on later runs

After the initial database import, the complete repeat-start sequence is:

```bash
# Terminal 1
cd /Users/aabiskar/Desktop/Neo
docker compose up -d postgres
```

```bash
# Terminal 2
cd /Users/aabiskar/Desktop/Neo
source .venv/bin/activate
DATABASE_URL=postgresql://neo:neo-development@127.0.0.1:5433/neo \
python -m uvicorn backend.api:app --host 127.0.0.1 --port 8001 --reload
```

```bash
# Terminal 3
cd /Users/aabiskar/Desktop/Neo/frontend
VITE_API_URL=http://127.0.0.1:8001 \
npm run dev -- --host 127.0.0.1 --port 5173
```

## Verifying the application

Use these URLs while both processes are running:

- Application: <http://127.0.0.1:5173>
- Interactive API documentation: <http://127.0.0.1:8001/docs>
- Backend health and active data source: <http://127.0.0.1:8001/health>
- Search API: <http://127.0.0.1:8001/search>
- Publication options API: <http://127.0.0.1:8001/publication-options>

The initial application load should show thousands of samples rather than zero
results. If it shows zero, confirm that the backend is running on port `8001`
and that `VITE_API_URL` used the same port when the frontend was started.

The health endpoint should report `"data_source": "postgresql"` when
`DATABASE_URL` is configured. If it reports `"csv"`, the backend is running in
migration fallback mode.

Because environment variables are scoped to the terminal that defines them,
the safest backend command includes the connection string directly:

```bash
DATABASE_URL=postgresql://neo:neo-development@127.0.0.1:5433/neo \
python -m uvicorn backend.api:app \
  --host 127.0.0.1 \
  --port 8001 \
  --reload
```

## Authors and contributors

### Project author and maintainer

- **Aabiskar Thapa Kshetri** ([@aabikshetri](https://github.com/aabikshetri)) — project design,
  full-stack development, PostgreSQL architecture, data-processing workflow,
  visualization implementation, and maintenance.
- **Faculty Mentor: Robert K. Booth** — rkb205@lehigh.edu

### Scientific data acknowledgement

AmoebaScope uses data derived from the
[Neotoma Paleoecology Database](https://www.neotomadb.org/). Neotoma and the
researchers who collected, analyzed, curated, and published the original
datasets remain the authoritative sources for those records. They are data
providers and scientific contributors to the underlying resource; this does
not imply that every Neotoma contributor is an author of the AmoebaScope
software.

When using exported data or results, cite the relevant original publications
shown by AmoebaScope's publication metadata and follow Neotoma's current data
citation guidance. Software users should also acknowledge AmoebaScope and the
specific version or Git commit used so an analysis can be reproduced.

## Production deployment

Deploy PostgreSQL and the FastAPI backend before building the frontend:

1. Provision a managed PostgreSQL database.
2. Set `DATABASE_URL` as a backend secret.
3. Run `scripts/import_runtime_data.py` against that database from a trusted
   administrative environment.
4. Set `CORS_ORIGINS` on the backend to the production frontend origin.
5. Deploy the backend using `backend/Dockerfile`.
6. Set the frontend's `VITE_API_URL` to the public HTTPS backend URL.
7. Build and deploy the frontend.

Do not point a deployed frontend at `127.0.0.1`; that address refers to each
visitor's own computer.

PostgreSQL currently provides durable normalized storage and performs indexed
sample/publication filtering. Scientific matrix calculations still use Pandas,
NumPy, SciPy, and scikit-learn after the required runtime records are loaded.
This preserves current numerical behavior while allowing further endpoints to
move into SQL incrementally.

## Stopping the application

1. Press `Ctrl+C` in the frontend terminal.
2. Press `Ctrl+C` in the backend terminal.
3. Stop PostgreSQL without deleting its imported data:

```bash
cd /Users/aabiskar/Desktop/Neo
docker compose stop postgres
```

The next `docker compose up -d postgres` reuses the preserved database volume.

## Troubleshooting

### Vite reports an unsupported Node version

Run the frontend through the project script:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Do not invoke `vite` directly. The project script selects Node 22 automatically.

You can confirm that a temporary Node 22 runtime is available with:

```bash
npx --yes --package=node@22 node --version
```

### A port is already in use

Inspect the relevant port:

```bash
lsof -nP -iTCP:8001 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

Stop the existing process or choose another port. If the backend port changes,
use the same new address in `VITE_API_URL`.

### Backend dependencies are missing

```bash
cd /Users/aabiskar/Desktop/Neo
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

### Frontend optional dependencies are missing

```bash
cd /Users/aabiskar/Desktop/Neo/frontend
npm install --include=optional
```

```bash
curl http://127.0.0.1:8001/health
```
