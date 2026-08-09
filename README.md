# AmoebaScope

**Exploration and visualization of testate amoeba ecology and paleoecology using the Neotoma Paleoecology Database.**

AmoebaScope is a web application for filtering, visualizing, analyzing, and
exporting testate amoeba surface-sample data. It combines a React frontend,
FastAPI backend, PostgreSQL runtime database, optional Redis shared cache, and
background scientific workers.

## What the application does

- Filters samples by site, publication, pH, water-table depth, and location.
- Displays geographic distributions and environmental gradients.
- Compares multiple taxa along environmental gradients.
- Calculates percentage-weighted environmental optima.
- Downloads wide CSV files with one row per sample and taxa as columns.
- Reports data coverage for the active sample selection.
- Runs modern-analogue and NMDS analyses.
- Exports reproducibility metadata and analysis results.

Neotoma remains the authoritative data source. AmoebaScope uses a curated local
runtime copy so interactive requests do not repeatedly query the public Neotoma
service.

## Quick start for an existing installation

Start Docker Desktop, then run from the repository root:

```bash
docker compose up -d postgres redis backend worker-analogue worker-nmds
docker compose ps
```

Start the frontend in another terminal:

```bash
cd frontend
VITE_API_URL=http://127.0.0.1:8001 \
npm run dev -- --host 127.0.0.1 --port 5173
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

Verify the services:

```bash
docker compose exec redis redis-cli ping
curl http://127.0.0.1:8001/health
```

Redis should return `PONG`; health should report `"data_source":"postgresql"`.

## First-time installation

### Requirements

- Git
- Python 3.9 or newer
- Docker Desktop
- Node.js 20.19+ or 22.12+ and npm
- Approximately 10 GB of free working space; more is recommended for Docker

Check the tools:

```bash
git --version
python3 --version
docker --version
node --version
npm --version
```

On Windows PowerShell, use `py --version` if `python3` is unavailable.

### 1. Clone the repository

macOS/Linux:

```bash
cd ~
git clone https://github.com/aabikshetri/neo-paleo-platform.git
cd neo-paleo-platform
```

Windows PowerShell:

```powershell
Set-Location $HOME
git clone https://github.com/aabikshetri/neo-paleo-platform.git
Set-Location neo-paleo-platform
```

### 2. Create the Python environment

macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r backend/requirements.txt
```

Windows PowerShell:

```powershell
py -m venv .venv
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r backend\requirements.txt
```

### 3. Install the frontend

```bash
cd frontend
npm install
cd ..
```

If Vite rejects the installed Node version, install Node 22 LTS or verify the
temporary runtime with:

```bash
npx --yes --package=node@22 node --version
```

### 4. Start PostgreSQL

Open Docker Desktop and wait until `docker info` succeeds:

```bash
docker compose up -d postgres
docker compose ps
```

PostgreSQL is available to the host on port `5433`.

### 5. Import the runtime data

This creates and populates AmoebaScope's PostgreSQL tables from the processed
files included in the repository. Run it on the first installation and after a
data refresh—not on every startup.

macOS/Linux:

```bash
source .venv/bin/activate
export DATABASE_URL=postgresql://neo:neo-development@127.0.0.1:5433/neo
python scripts/import_runtime_data.py
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
$env:DATABASE_URL = "postgresql://neo:neo-development@127.0.0.1:5433/neo"
python scripts\import_runtime_data.py
```

The local runtime currently contains approximately 4,389 samples, 65,042 taxon
observations, and 6,326 dataset-publication links.

### 6. Build and start the complete backend stack

```bash
docker compose build backend
docker compose up -d postgres redis backend worker-analogue worker-nmds
docker compose ps
```

Expected services:

| Service | Purpose | Local access |
| --- | --- | --- |
| `postgres` | Runtime scientific database | `127.0.0.1:5433` |
| `redis` | Shared cache and job queue | Docker network only |
| `backend` | FastAPI application | `127.0.0.1:8001` |
| `worker-analogue` | Fast modern-analogue jobs | Docker network only |
| `worker-nmds` | CPU-intensive NMDS jobs | Docker network only |

Verify them:

```bash
docker compose exec postgres pg_isready -U neo -d neo
docker compose exec redis redis-cli ping
curl http://127.0.0.1:8001/health
docker compose logs --tail=30 backend worker-analogue worker-nmds
```

### 7. Start the frontend

macOS/Linux:

```bash
cd frontend
VITE_API_URL=http://127.0.0.1:8001 \
npm run dev -- --host 127.0.0.1 --port 5173
```

Windows PowerShell:

```powershell
Set-Location frontend
$env:VITE_API_URL = "http://127.0.0.1:8001"
npm run dev -- --host 127.0.0.1 --port 5173
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173).

## Normal startup and shutdown

After the first installation, the PostgreSQL Docker volume preserves the
imported data.

Start:

```bash
cd ~/neo-paleo-platform
docker compose up -d postgres redis backend worker-analogue worker-nmds
```

Then start the frontend from `frontend/` as shown above.

Stop the containers without deleting data:

```bash
docker compose stop
```

Stop and remove containers while preserving the named database volume:

```bash
docker compose down
```

Do not add `--volumes` unless you intentionally want to delete the imported
PostgreSQL database.

## Running without Redis

Redis improves multi-worker caching and moves expensive analyses outside API
requests, but it is optional. Without it, the application uses a bounded cache
inside each API process and executes analyses synchronously.

Start PostgreSQL only:

```bash
docker compose up -d postgres
```

Run the backend from the host:

```bash
source .venv/bin/activate
unset REDIS_URL
DATABASE_URL=postgresql://neo:neo-development@127.0.0.1:5433/neo \
python -m uvicorn backend.api:app --host 127.0.0.1 --port 8001 --reload
```

All scientific features remain available; long analyses occupy the API worker
until completion.

## How the system works

```mermaid
sequenceDiagram
    participant U as Researcher
    participant F as React frontend
    participant A as FastAPI workers
    participant R as Redis
    participant WA as Analogue worker
    participant WN as NMDS worker
    participant P as PostgreSQL

    U->>F: Filter samples
    F->>A: GET /search-page
    A->>R: Check shared cache
    alt cache miss
        A->>P: Execute indexed query
        P-->>A: Page and summary
        A->>R: Cache result
    end
    A-->>F: Rows, totals, selection token

    U->>F: Run NMDS or analogue analysis
    F->>A: POST /jobs/...
    A->>R: Deduplicate and queue by analysis type
    alt Analogue search
        WA->>R: Claim analogue job
        WA->>P: Read selected scientific data
        WA->>R: Store result
    else NMDS
        WN->>R: Claim NMDS job
        WN->>P: Read selected scientific data
        WN->>R: Store result
    end
    F->>A: Poll job status
    A-->>F: Completed result
```

### Selection tokens and pagination

Search initially returns 250 rows, exact summary statistics, the complete
result count, and a stateless selection token. Coverage, taxa, CSV, NMDS, and
analogue requests reuse this token instead of repeatedly uploading thousands of
sample IDs. Existing explicit `sampleids` request bodies remain supported.

### Scientific processing

- Only positive, valid abundance observations are retained.
- Abundances are normalized to 100% within each sample.
- Duplicate recorded taxon names are combined.
- Percentage-weighted means estimate pH or water-table optima.
- Bray-Curtis dissimilarity is used for analogue and NMDS workflows.
- Fixed seeds and recorded settings support reproducibility.
- The normal NMDS run performs the requested ordination only. Optional extended
  sensitivity diagnostics add a comparison-dimensionality fit and two
  alternate-seed fits, so they can take roughly four times as long.

These rules are shared between PostgreSQL and processed-file fallback paths.

### PostgreSQL tables

- `samples`
- `taxon_abundances`
- `sample_taxon_profiles`
- `publications`
- `dataset_publications`
- `data_refreshes`
- `publication_sample_summary` (materialized view)
- `sample_coverage_summary` (materialized view)

Materialized views are refreshed by `scripts/import_runtime_data.py`. An older
database without them remains compatible through automatic query fallbacks.

## Architecture and project structure

```text
Neo/
├── backend/
│   ├── api.py                 Stable backend.api:app entry point
│   ├── main.py                FastAPI factory and middleware
│   ├── database.py            PostgreSQL queries, pools, replica routing
│   ├── cache.py               Redis and process-local caching
│   ├── jobs.py                Scientific job queue
│   ├── worker.py              Background worker entry point
│   ├── routers/               HTTP route registration
│   ├── handlers/              Endpoint orchestration
│   ├── schemas/               Request validation
│   ├── services/              Scientific and selection logic
│   ├── repositories/          Data-access boundary
│   ├── schema.sql             Runtime database schema
│   └── data/processed/        Reproducible import inputs
├── frontend/                  React, TypeScript, Vite
├── loadtests/                 Locust performance profile
├── scripts/                   Imports, refreshes, and SQL monitoring
├── tests/                     Unit, route, selection, job, and DB checks
└── docker-compose.yml         PostgreSQL, Redis, API, and worker stack
```

The frontend lazily downloads maps and scientific visualization libraries.
Large maps use canvas rendering and zoom-aware marker clustering. Publication
search renders no more than 40 matching options, and obsolete browser searches
are cancelled when a newer request starts.

## API overview

FastAPI documentation is available while the backend runs:

- [http://127.0.0.1:8001/docs](http://127.0.0.1:8001/docs)
- [http://127.0.0.1:8001/openapi.json](http://127.0.0.1:8001/openapi.json)

Important endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Service and data-source health |
| `GET /search-page` | Paginated filters, totals, and selection token |
| `GET /publication-options` | Publication citations and sample counts |
| `POST /taxa/aggregate` | Taxon abundance for a selection |
| `POST /calibration/quality` | Coverage summary |
| `POST /export/taxa-csv` | Wide filtered CSV |
| `POST /jobs/nmds` | Queue or synchronously execute NMDS |
| `POST /jobs/modern-analogues` | Queue or execute analogue analysis |
| `GET /jobs/{job_id}` | Background-job status and result |
| `DELETE /jobs/{job_id}` | Cancel an obsolete queued job |

The original synchronous calibration endpoints remain available for backwards
compatibility.

## Configuration

Copy `.env.example` as a reference. Do not commit passwords or production URLs.

| Variable | Default/use |
| --- | --- |
| `DATABASE_URL` | Primary PostgreSQL connection; enables PostgreSQL mode |
| `READ_DATABASE_URL` | Optional read-only replica |
| `REDIS_URL` | Optional shared cache and job queue |
| `SCIENTIFIC_JOB_TYPES` | Worker queue assignment (`nmds` or `modern_analogue`) |
| `CORS_ORIGINS` | Allowed frontend origins |
| `WEB_CONCURRENCY` | API process count; Compose uses `2` |
| `DATABASE_POOL_SIZE` | Connections per process; Compose uses `4` |
| `DATABASE_CACHE_SIZE` | Local cache entries per process |
| `DATABASE_CACHE_TTL_SECONDS` | Local and Redis cache lifetime |
| `REQUEST_TIMEOUT_SECONDS` | API request timeout |
| `UVICORN_LIMIT_CONCURRENCY` | In-flight requests per process |
| `FORWARDED_ALLOW_IPS` | Trusted reverse proxies |
| `VITE_API_URL` | Backend URL embedded in the frontend build |

Each API worker has its own memory and PostgreSQL pool. Two workers are a safe
starting point; increase only after load testing and monitoring total memory and
database connections.

## Tests

Run the normal suite from the repository root:

```bash
source .venv/bin/activate
python -m unittest discover -s tests -p 'test_*.py' -v
```

Run read-only PostgreSQL integration checks:

```bash
TEST_DATABASE_URL=postgresql://neo:neo-development@127.0.0.1:5433/neo \
python -m unittest tests.test_postgres_integration -v
```

Frontend type check and production build:

```bash
cd frontend
npm run build
```

## Load testing

Use a separate environment so Locust is not installed in the application:

```bash
python3 -m venv .venv-loadtest
source .venv-loadtest/bin/activate
pip install -r loadtests/requirements.txt
locust -f loadtests/locustfile.py --host http://127.0.0.1:8001
```

Open [http://127.0.0.1:8089](http://127.0.0.1:8089). Begin with approximately
10 users and increase gradually while monitoring p95 latency, errors, CPU,
memory, Redis, and PostgreSQL.

## PostgreSQL monitoring

The local container preloads `pg_stat_statements`. Enable it once:

```bash
docker compose exec postgres \
  psql -U neo -d neo \
  -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
```

Run the supplied reports from a host with `psql` installed:

```bash
psql "$DATABASE_URL" -f scripts/enable_pg_stat_statements.sql
psql "$DATABASE_URL" -f scripts/explain_runtime_queries.sql
```

`EXPLAIN ANALYZE` executes queries. The included examples are read-only.

## Troubleshooting

### Backend says `data_source: csv`

The backend did not receive `DATABASE_URL`. Restart it with the variable in the
same command or use the Docker backend service.

### Redis worker repeatedly restarts

```bash
docker compose exec redis redis-cli ping
docker compose logs --tail=100 worker-analogue worker-nmds redis
docker inspect -f 'status={{.State.Status}} restarts={{.RestartCount}}' \
  "$(docker compose ps -q worker-analogue)"
```

The current worker uses a dedicated blocking Redis connection; rebuild the
backend image after pulling worker fixes:

```bash
docker compose build backend
docker compose up -d --force-recreate backend worker-analogue worker-nmds
```

Restart Docker Desktop. Do not factory-reset Docker or remove volumes unless
you intentionally want to erase the local PostgreSQL data.

### Port already in use

```bash
lsof -nP -iTCP:8001 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

Stop the old process or choose another port and update `VITE_API_URL`.

### Inspect all service logs

```bash
docker compose ps
docker compose logs --tail=100 postgres redis backend worker-analogue worker-nmds
```

## Authors and acknowledgements

- **Aabiskar Thapa Kshetri** ([@aabikshetri](https://github.com/aabikshetri)) — project design, software development, data engineering, and maintenance; `aat226@lehigh.edu`.
- **Robert K. Booth** — faculty mentor and scientific collaborator; `rkb205@lehigh.edu`.
- **London Diiorio** — AmoebaScope logo design.

Scientific data are provided by the
[Neotoma Paleoecology Database](https://www.neotomadb.org/). Users should follow
Neotoma's data-use, citation, and contributor-acknowledgement policies when
publishing results derived from the platform.
