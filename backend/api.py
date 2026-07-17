import json
import inspect
from pathlib import Path

import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import numpy as np

from scipy.stats import pearsonr, spearmanr
from scipy.spatial.distance import pdist, squareform
from scipy.spatial import procrustes

from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from sklearn.manifold import MDS
from sklearn.isotonic import IsotonicRegression

BASE_DIR = Path(__file__).resolve().parent

INDEX = (
    BASE_DIR /
    "data" /
    "processed" /
    "testate_search_index.csv"
)


TAXA_INDEX = (
    BASE_DIR /
    "data" /
    "processed" /
    "taxa_abundance.csv"
)

SITES_INDEX = BASE_DIR / "data" / "processed" / "testate_amoebae_surface_sites.csv"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Loading:", INDEX)
print("Exists:", INDEX.exists())

df = pd.read_csv(INDEX)

if SITES_INDEX.exists():
    publication_df = pd.read_csv(SITES_INDEX, usecols=["datasetid", "doi"])
    publication_df = publication_df.drop_duplicates(subset=["datasetid"])
    df = df.merge(publication_df, on="datasetid", how="left")

metadata_json = BASE_DIR.parent / "scripts" / "all_testate_amoebae_surface_samples.json"
if metadata_json.exists():
    try:
        metadata_records = json.loads(metadata_json.read_text())
        investigator_rows = []
        for response in metadata_records:
            for item in response.get("data", []):
                site = item.get("site", {})
                collection_unit = site.get("collectionunit", {})
                datasets = (
                    collection_unit.get("datasets", site.get("datasets", []))
                    if isinstance(collection_unit, dict)
                    else site.get("datasets", [])
                )
                for dataset in datasets:
                    names = [
                        person.get("contactname", "").strip()
                        for person in dataset.get("datasetpi", [])
                        if person.get("contactname")
                    ]
                    investigator_rows.append({
                        "datasetid": dataset.get("datasetid"),
                        "investigators": "; ".join(names),
                    })
        if investigator_rows:
            investigators_df = pd.DataFrame(investigator_rows).drop_duplicates("datasetid")
            df = df.merge(investigators_df, on="datasetid", how="left")
    except (OSError, ValueError, TypeError):
        df["investigators"] = None

if "investigators" not in df.columns:
    df["investigators"] = None

print("Loading taxa:", TAXA_INDEX)
print("Taxa exists:", TAXA_INDEX.exists())

taxa_df = pd.read_csv(TAXA_INDEX)

taxa_df["abundance"] = pd.to_numeric(
    taxa_df["abundance"],
    errors="coerce"
)

for col in ["pH", "water_table_depth", "altitude"]:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")

# Neotoma exports can contain numeric missing-value sentinels. Remove them
# before summaries, filters, quality checks, and environmental coloring.
if "pH" in df.columns:
    df.loc[(df["pH"] < 0) | (df["pH"] > 14), "pH"] = np.nan
if "water_table_depth" in df.columns:
    df.loc[df["water_table_depth"] <= -90, "water_table_depth"] = np.nan


def get_lon_lat(geo):
    try:
        g = json.loads(geo)

        if g["type"] == "Point":
            lon, lat = g["coordinates"]
            return lon, lat

        if g["type"] == "Polygon":
            ring = g["coordinates"][0]

            lon = sum(p[0] for p in ring) / len(ring)
            lat = sum(p[1] for p in ring) / len(ring)

            return lon, lat

    except Exception:
        pass

    return None, None


def build_summary(df):

    return {
        "samples": int(len(df)),

        "sites": int(
            df["siteid"].nunique()
        ),

        "mean_ph": round(
            df["pH"].dropna().mean(),
            2,
        ),

        "mean_water_table": round(
            df["water_table_depth"]
            .dropna()
            .mean(),
            2,
        ),

        "mean_altitude": round(
            df["altitude"]
            .dropna()
            .mean(),
            2,
        ),
    }


def run_environmental_pca(df):

    cols = [
        "pH",
        "water_table_depth",
        "altitude",
    ]

    temp = (
        df[cols]
        .dropna()
        .copy()
    )

    if len(temp) < 3:
        return {
            "pc1": [],
            "pc2": [],
            "explained_variance": [],
        }

    scaled = (
        StandardScaler()
        .fit_transform(temp)
    )

    pca = PCA(n_components=2)

    pcs = pca.fit_transform(
        scaled
    )

    return {
        "pc1": pcs[:, 0].tolist(),
        "pc2": pcs[:, 1].tolist(),
        "explained_variance":
            pca.explained_variance_ratio_.tolist(),
        "samples": len(temp),
        "variables": cols,
    }


def lump_taxon_name(name: str, level: str = "genus"):
    if not isinstance(name, str):
        return "Unknown"

    name = name.strip()

    if not name:
        return "Unknown"

    if level == "genus":
        return name.split()[0]

    return name


def compute_taxa_lumping(df, level="genus"):
    taxon_col = "taxon_name"
    abundance_col = "abundance"
    sample_col = "sampleid"

    if taxon_col not in df.columns:
        return {
            "error": f"Missing column: {taxon_col}",
            "available_columns": list(df.columns),
        }

    if abundance_col not in df.columns:
        return {
            "error": f"Missing column: {abundance_col}",
            "available_columns": list(df.columns),
        }

    if sample_col not in df.columns:
        return {
            "error": f"Missing column: {sample_col}",
            "available_columns": list(df.columns),
        }

    temp = df[[sample_col, taxon_col, abundance_col]].copy()

    temp[abundance_col] = pd.to_numeric(
        temp[abundance_col],
        errors="coerce"
    )

    temp = temp.dropna(subset=[sample_col, taxon_col, abundance_col])
    temp = temp[temp[abundance_col] > 0]

    if temp.empty:
        return []

    temp["lumped_taxon"] = temp[taxon_col].apply(
        lambda x: lump_taxon_name(x, level)
    )

    # Values come from a mixture of count (NISP) and percent datasets. Convert
    # every sample to a 100% composition before combining them so the units can
    # never be added together and samples with larger count totals do not get
    # more weight.
    sample_totals = temp.groupby(sample_col)[abundance_col].transform("sum")
    temp["sample_percent"] = temp[abundance_col] / sample_totals * 100

    # Several species can lump into the same genus within one sample.
    per_sample = (
        temp.groupby([sample_col, "lumped_taxon"], as_index=False)["sample_percent"]
        .sum()
    )
    sample_count = temp[sample_col].nunique()

    result = (
        per_sample.groupby("lumped_taxon")["sample_percent"]
        .sum()
        .div(sample_count)
        .reset_index()
        .rename(columns={"sample_percent": "percentage"})
        .sort_values("percentage", ascending=False)
    )

    # Keep the legacy field while clients migrate; its value is now explicitly
    # a percentage, not a mixture of counts and percentages.
    result["abundance"] = result["percentage"]

    return result.to_dict(orient="records")


def build_genus_profiles(source):
    """Normalize once per sample, then reuse the genus profiles in requests."""
    temp = source[["sampleid", "taxon_name", "abundance"]].copy()
    temp["abundance"] = pd.to_numeric(temp["abundance"], errors="coerce")
    temp = temp.dropna(subset=["sampleid", "taxon_name", "abundance"])
    temp = temp[temp["abundance"] > 0]
    temp["lumped_taxon"] = temp["taxon_name"].apply(
        lambda value: lump_taxon_name(value, "genus")
    )
    totals = temp.groupby("sampleid")["abundance"].transform("sum")
    temp["percentage"] = temp["abundance"] / totals * 100
    return (
        temp.groupby(["sampleid", "lumped_taxon"], as_index=False)["percentage"]
        .sum()
        .sort_values(["sampleid", "percentage"], ascending=[True, False])
    )


genus_profiles_df = build_genus_profiles(taxa_df)


def limit_taxa_groups(records, limit):
    if limit is None or limit <= 0 or len(records) <= limit:
        return records

    # Reserve one displayed slice for all genera outside the requested limit.
    kept = records[: max(limit - 1, 0)]
    remainder = records[max(limit - 1, 0):]
    other_percentage = sum(row["percentage"] for row in remainder)

    return kept + [{
        "lumped_taxon": "Other",
        "percentage": other_percentage,
        "abundance": other_percentage,
    }]







@app.get("/")
def root():
    return {"status": "running"}

@app.get("/summary")
def summary():
    return build_summary(df)

@app.get("/correlation")
def correlation(
    x: str,
    y: str,
):

    temp = (
        df[[x, y]]
        .dropna()
        .copy()
    )

    if len(temp) < 2:
        return {
            "correlation": None,
            "p_value": None,
            "n": 0,
        }

    r, p = pearsonr(
        temp[x],
        temp[y]
    )

    return {
        "correlation": float(r),
        "p_value": float(p),
        "n": int(len(temp)),
    }

@app.get("/pca/environment")
def environmental_pca():
    return run_environmental_pca(df)


@app.get("/taxa/lumped")
def taxa_lumped(level: str = "genus"):
    return compute_taxa_lumping(taxa_df, level)


@app.get("/taxa/top")
def taxa_top(limit: int = 25):
    temp = taxa_df.dropna(
        subset=["taxon_name", "abundance"]
    ).copy()

    result = (
        temp.groupby("taxon_name")["abundance"]
        .sum()
        .reset_index()
        .sort_values("abundance", ascending=False)
        .head(limit)
    )

    return result.to_dict(orient="records")


@app.get("/publication-options")
def publication_options():
    options = df[["sitename", "doi"]].dropna(subset=["doi"]).copy()
    options["doi"] = options["doi"].astype(str).str.split(";")
    options = options.explode("doi")
    options["doi"] = options["doi"].str.strip().str.lower()
    options = options[options["doi"].ne("")].drop_duplicates(subset=["doi"])
    options = options.sort_values(["sitename", "doi"], na_position="last")
    options = options.astype(object).where(pd.notnull(options), None)
    return options.to_dict(orient="records")

@app.get("/taxa/by-samples")
def taxa_by_samples(sampleids: str, level: str = "genus", limit: int = 25):
    ids = [
        int(x)
        for x in sampleids.split(",")
        if x.strip().isdigit()
    ]

    temp = taxa_df[
        taxa_df["sampleid"].isin(ids)
    ].copy()

    if temp.empty:
        return []

    result = compute_taxa_lumping(temp, level)
    return limit_taxa_groups(result, max(1, min(limit, 100)))


class TaxaAggregateRequest(BaseModel):
    sampleids: list[int]
    level: str = "genus"
    limit: int = 25


@app.post("/taxa/aggregate")
def taxa_aggregate(request: TaxaAggregateRequest):
    ids = list(dict.fromkeys(request.sampleids))[:5000]
    if not ids:
        return []

    if request.level != "genus":
        selected = taxa_df[taxa_df["sampleid"].isin(ids)]
        return limit_taxa_groups(
            compute_taxa_lumping(selected, request.level),
            max(1, min(request.limit, 100)),
        )

    selected = genus_profiles_df[genus_profiles_df["sampleid"].isin(ids)]
    sample_count = selected["sampleid"].nunique()
    if sample_count == 0:
        return []

    result = (
        selected.groupby("lumped_taxon", as_index=False)["percentage"]
        .sum()
        .assign(percentage=lambda frame: frame["percentage"] / sample_count)
        .sort_values("percentage", ascending=False)
    )
    result["abundance"] = result["percentage"]
    return limit_taxa_groups(
        result.to_dict(orient="records"),
        max(1, min(request.limit, 100)),
    )


@app.get("/taxa/composition-by-samples")
def taxa_composition_by_samples(
    sampleids: str,
    level: str = "genus",
    limit: int = 8,
):
    ids = list(dict.fromkeys(
        int(value)
        for value in sampleids.split(",")
        if value.strip().isdigit()
    ))[:50]
    group_limit = max(2, min(limit, 25))

    if not ids:
        return []

    selected = taxa_df[taxa_df["sampleid"].isin(ids)].copy()
    if selected.empty:
        return []

    records = []
    for sampleid in ids:
        sample = selected[selected["sampleid"] == sampleid]
        if sample.empty:
            continue

        composition = compute_taxa_lumping(sample, level)
        records.append({
            "sampleid": sampleid,
            "composition": limit_taxa_groups(composition, group_limit),
        })

    return records


class SampleProfilesRequest(BaseModel):
    sampleids: list[int]
    level: str = "genus"
    limit: int = 8


class CalibrationRequest(BaseModel):
    sampleids: list[int]


class AnalogueRequest(BaseModel):
    target_sampleid: int
    calibration_sampleids: list[int]
    limit: int = 10
    exclude_same_site: bool = True
    exclude_same_doi: bool = True


class NmdsRequest(BaseModel):
    sampleids: list[int]
    max_samples: int = 500
    prevalence: float = 0.02
    random_seed: int = 42
    n_init: int = 10
    dimensions: int = 2
    target_sampleid: int | None = None
    run_sensitivity: bool = True


@app.post("/calibration/quality")
def calibration_quality(request: CalibrationRequest):
    ids = list(dict.fromkeys(request.sampleids))[:5000]
    selected = df[df["sampleid"].isin(ids)].drop_duplicates("sampleid").copy()
    profiles = genus_profiles_df[genus_profiles_df["sampleid"].isin(ids)]
    sample_count = len(selected)
    taxa_ids = set(profiles["sampleid"].astype(int).tolist())
    richness = profiles.groupby("sampleid")["lumped_taxon"].nunique()

    def missing_count(column):
        return int(selected[column].isna().sum()) if column in selected else sample_count

    def numeric_range(column):
        values = pd.to_numeric(selected[column], errors="coerce").dropna()
        if values.empty:
            return {"min": None, "max": None}
        return {"min": float(values.min()), "max": float(values.max())}

    units = []
    if "water_table_depth_units" in selected:
        units = sorted(
            selected["water_table_depth_units"].dropna().astype(str).str.strip().unique().tolist()
        )
    doi_values = (
        selected["doi"].dropna().astype(str).str.split(";").explode().str.strip().str.lower()
    )
    doi_values = doi_values[doi_values.ne("")]

    return {
        "sample_count": sample_count,
        "site_count": int(selected["siteid"].nunique()),
        "dataset_count": int(selected["datasetid"].nunique()),
        "samples_with_doi": sample_count - missing_count("doi"),
        "unique_doi_count": int(doi_values.nunique()),
        "taxa_sample_count": len(taxa_ids),
        "missing_taxa": sample_count - len(taxa_ids),
        "missing_ph": missing_count("pH"),
        "missing_water_table": missing_count("water_table_depth"),
        "missing_doi": missing_count("doi"),
        "low_richness_samples": int((richness < 5).sum()),
        "median_genus_richness": float(richness.median()) if not richness.empty else None,
        "ph_range": numeric_range("pH"),
        "water_table_range": numeric_range("water_table_depth"),
        "water_table_units": units,
    }


@app.post("/calibration/modern-analogues")
def modern_analogues(request: AnalogueRequest):
    candidate_ids = list(dict.fromkeys(request.calibration_sampleids))[:5000]
    candidate_ids = [sampleid for sampleid in candidate_ids if sampleid != request.target_sampleid]
    original_candidate_count = len(candidate_ids)
    sample_metadata = (
        df[df["sampleid"].isin([request.target_sampleid, *candidate_ids])]
        .drop_duplicates("sampleid")
        .set_index("sampleid")
    )
    if request.target_sampleid not in sample_metadata.index:
        return {"error": "The target sample metadata is unavailable.", "matches": []}

    target_metadata = sample_metadata.loc[request.target_sampleid]
    target_siteid = target_metadata.get("siteid")
    target_doi_value = target_metadata.get("doi")
    target_dois = {
        value.strip().lower()
        for value in str(target_doi_value if pd.notna(target_doi_value) else "").split(";")
        if value.strip()
    }

    def retain_candidate(sampleid):
        if sampleid not in sample_metadata.index:
            return False
        candidate = sample_metadata.loc[sampleid]
        if (
            request.exclude_same_site
            and pd.notna(target_siteid)
            and candidate.get("siteid") == target_siteid
        ):
            return False
        if request.exclude_same_doi and target_dois:
            candidate_doi_value = candidate.get("doi")
            candidate_dois = {
                value.strip().lower()
                for value in str(candidate_doi_value if pd.notna(candidate_doi_value) else "").split(";")
                if value.strip()
            }
            if target_dois.intersection(candidate_dois):
                return False
        return True

    candidate_ids = [sampleid for sampleid in candidate_ids if retain_candidate(sampleid)]
    selected_ids = [request.target_sampleid, *candidate_ids]
    selected = genus_profiles_df[genus_profiles_df["sampleid"].isin(selected_ids)]
    if request.target_sampleid not in set(selected["sampleid"].astype(int)):
        return {"error": "The target sample has no usable taxa composition.", "matches": []}

    matrix = selected.pivot_table(
        index="sampleid", columns="lumped_taxon", values="percentage", fill_value=0
    )
    if request.target_sampleid not in matrix.index:
        return {"error": "The target sample has no usable taxa composition.", "matches": []}

    available = [sampleid for sampleid in candidate_ids if sampleid in matrix.index]
    if not available:
        return {"error": "No calibration samples with taxa data are available.", "matches": []}

    target = matrix.loc[request.target_sampleid]
    distances = matrix.loc[available].sub(target, axis="columns").abs().sum(axis=1) / 200
    best = distances.nsmallest(max(1, min(request.limit, 25)))
    metadata = sample_metadata[sample_metadata.index.isin(best.index)]

    def composition_records(values, limit=10):
        return [
            {"lumped_taxon": str(taxon), "percentage": float(percentage)}
            for taxon, percentage in values[values > 0].nlargest(limit).items()
        ]

    matches = []
    for sampleid, distance in best.items():
        candidate = matrix.loc[sampleid]
        shared = pd.concat([target.rename("target"), candidate.rename("candidate")], axis=1)
        shared["minimum"] = shared[["target", "candidate"]].min(axis=1)
        shared_genera = shared[shared["minimum"] > 0].nlargest(5, "minimum").index.tolist()
        row = metadata.loc[sampleid] if sampleid in metadata.index else None

        def metadata_value(column):
            if row is None or column not in row or pd.isna(row[column]):
                return None
            value = row[column]
            return value.item() if hasattr(value, "item") else value

        matches.append({
            "sampleid": int(sampleid),
            "bray_curtis": float(distance),
            "analogue_class": "close" if distance <= 0.2 else "possible" if distance <= 0.4 else "poor",
            "sitename": metadata_value("sitename"),
            "datasetid": metadata_value("datasetid"),
            "doi": metadata_value("doi"),
            "pH": metadata_value("pH"),
            "water_table_depth": metadata_value("water_table_depth"),
            "water_table_depth_units": metadata_value("water_table_depth_units"),
            "shared_genera": shared_genera,
            "composition": composition_records(candidate),
        })

    return {
        "target_sampleid": request.target_sampleid,
        "candidate_count": len(available),
        "excluded_candidate_count": original_candidate_count - len(candidate_ids),
        "exclude_same_site": request.exclude_same_site,
        "exclude_same_doi": request.exclude_same_doi,
        "method": "Bray-Curtis dissimilarity on sample-normalized genus percentages",
        "target_composition": composition_records(target),
        "matches": matches,
    }


@app.post("/calibration/nmds")
def calibration_nmds(request: NmdsRequest):
    ids = list(dict.fromkeys(request.sampleids))[:5000]
    selected = genus_profiles_df[genus_profiles_df["sampleid"].isin(ids)]
    taxa_sample_ids = set(selected["sampleid"].astype(int))
    available_ids = [sampleid for sampleid in ids if sampleid in taxa_sample_ids]
    if len(available_ids) < 3:
        return {"error": "NMDS requires at least three samples with taxa data.", "points": []}

    max_samples = max(3, min(request.max_samples, 1000))
    sampled = len(available_ids) > max_samples
    if sampled:
        rng = np.random.default_rng(request.random_seed)
        site_rows = (
            df[df["sampleid"].isin(available_ids)][["sampleid", "siteid"]]
            .drop_duplicates("sampleid")
        )
        site_for_sample = dict(zip(site_rows["sampleid"].astype(int), site_rows["siteid"]))
        site_groups = {}
        for sampleid in available_ids:
            site = site_for_sample.get(sampleid)
            site_key = str(site) if pd.notna(site) else f"unknown-{sampleid}"
            site_groups.setdefault(site_key, []).append(sampleid)
        group_keys = list(site_groups)
        rng.shuffle(group_keys)
        for group in site_groups.values():
            rng.shuffle(group)
        analysis_ids = []
        depth = 0
        while len(analysis_ids) < max_samples:
            added = False
            for key in group_keys:
                group = site_groups[key]
                if depth < len(group):
                    analysis_ids.append(group[depth])
                    added = True
                    if len(analysis_ids) == max_samples:
                        break
            if not added:
                break
            depth += 1
        if (
            request.target_sampleid in available_ids
            and request.target_sampleid not in analysis_ids
        ):
            analysis_ids[-1] = request.target_sampleid
    else:
        analysis_ids = available_ids

    unfiltered_matrix = (
        selected[selected["sampleid"].isin(analysis_ids)]
        .pivot_table(index="sampleid", columns="lumped_taxon", values="percentage", fill_value=0)
        .reindex(analysis_ids)
    )
    original_genus_count = unfiltered_matrix.shape[1]

    def prepare_matrix(prevalence):
        minimum_occurrence = max(
            1,
            int(np.ceil(len(unfiltered_matrix) * max(0, min(prevalence, 1)))),
        )
        prepared = unfiltered_matrix.loc[
            :, (unfiltered_matrix > 0).sum(axis=0) >= minimum_occurrence
        ].copy()
        prepared = prepared.loc[prepared.sum(axis=1) > 0]
        # Taxon filtering changes retained totals by different amounts across
        # samples. Restore every retained assemblage to a 100% composition
        # before calculating Bray-Curtis dissimilarities.
        prepared = prepared.div(prepared.sum(axis=1), axis=0) * 100
        return prepared

    matrix = prepare_matrix(request.prevalence)
    if len(matrix) < 3 or matrix.shape[1] < 2:
        return {"error": "Too few samples or genera remain after prevalence filtering.", "points": []}

    condensed_distances = pdist(matrix.to_numpy(), metric="braycurtis")
    distances = squareform(condensed_distances)
    supports_normalized_stress = "normalized_stress" in inspect.signature(MDS).parameters

    def fit_nmds(dimensions, n_init, random_seed):
        options = {
            "n_components": dimensions,
            "metric": False,
            "dissimilarity": "precomputed",
            "random_state": random_seed,
            "n_init": n_init,
            "max_iter": 500,
            "eps": 1e-6,
        }
        if supports_normalized_stress:
            options["normalized_stress"] = True
        fitted = MDS(**options)
        fitted_coordinates = fitted.fit_transform(distances)
        if supports_normalized_stress:
            fitted_stress = float(fitted.stress_)
        else:
            denominator = float(np.square(distances).sum())
            fitted_stress = float(np.sqrt(fitted.stress_ / denominator)) if denominator > 0 else 0.0
        return fitted, fitted_coordinates, fitted_stress

    dimensions = 3 if request.dimensions == 3 else 2
    model, coordinates, stress = fit_nmds(
        dimensions,
        max(1, min(request.n_init, 20)),
        request.random_seed,
    )
    comparison_dimension = 3 if dimensions == 2 else 2
    _, _, comparison_stress = fit_nmds(
        comparison_dimension,
        max(1, min(request.n_init, 20)),
        request.random_seed,
    )
    stress_by_dimension = {
        str(dimensions): stress,
        str(comparison_dimension): comparison_stress,
    }
    stress_kind = "normalized Stress-1" if supports_normalized_stress else "approximated normalized stress"

    ordination_distances = pdist(coordinates, metric="euclidean")
    isotonic = IsotonicRegression(increasing=True, out_of_bounds="clip")
    monotonic_disparities = isotonic.fit_transform(
        condensed_distances,
        ordination_distances,
    )
    pair_count = min(2000, len(condensed_distances))
    pair_rng = np.random.default_rng(request.random_seed)
    pair_indexes = (
        np.sort(pair_rng.choice(len(condensed_distances), size=pair_count, replace=False))
        if len(condensed_distances) > pair_count
        else np.arange(len(condensed_distances))
    )

    initialization_sensitivity = []
    prevalence_sensitivity = []
    if request.run_sensitivity:
        for seed in [request.random_seed + 1, request.random_seed + 2]:
            _, alternate_coordinates, alternate_stress = fit_nmds(
                dimensions,
                max(1, min(request.n_init, 20)),
                seed,
            )
            _, _, disparity = procrustes(coordinates, alternate_coordinates)
            initialization_sensitivity.append({
                "random_seed": seed,
                "stress": alternate_stress,
                "procrustes_disparity": float(disparity),
            })

        tested_prevalence = sorted({0.0, float(request.prevalence), 0.05})
        for prevalence in tested_prevalence:
            alternate_matrix = prepare_matrix(prevalence)
            common_ids = matrix.index.intersection(alternate_matrix.index)
            if len(common_ids) < 3 or alternate_matrix.shape[1] < 2:
                correlation = None
            else:
                primary_common_distances = pdist(
                    matrix.loc[common_ids].to_numpy(), metric="braycurtis"
                )
                alternate_distances = pdist(
                    alternate_matrix.loc[common_ids].to_numpy(), metric="braycurtis"
                )
                correlation_value = spearmanr(
                    primary_common_distances,
                    alternate_distances,
                ).statistic
                correlation = (
                    float(correlation_value)
                    if np.isfinite(correlation_value)
                    else None
                )
            prevalence_sensitivity.append({
                "prevalence": prevalence,
                "genus_count": int(alternate_matrix.shape[1]),
                "sample_count": int(len(common_ids)),
                "distance_spearman": correlation,
            })

    target_id = request.target_sampleid if request.target_sampleid in matrix.index else None
    analogue_ids = set()
    if target_id is not None:
        target_position = matrix.index.get_loc(target_id)
        ranked_positions = np.argsort(distances[target_position])
        ranked_ids = [
            int(matrix.index[position])
            for position in ranked_positions
            if position != target_position
        ]
        analogue_ids = set(ranked_ids[:5])

    metadata = (
        df[df["sampleid"].isin(matrix.index)]
        .drop_duplicates("sampleid")
        .set_index("sampleid")
    )
    dominant = matrix.idxmax(axis=1)
    points = []
    for position, sampleid in enumerate(matrix.index):
        row = metadata.loc[sampleid] if sampleid in metadata.index else None

        def value(column):
            if row is None or column not in row or pd.isna(row[column]):
                return None
            item = row[column]
            return item.item() if hasattr(item, "item") else item

        points.append({
            "sampleid": int(sampleid),
            "nmds1": float(coordinates[position, 0]),
            "nmds2": float(coordinates[position, 1]),
            "nmds3": float(coordinates[position, 2]) if dimensions == 3 else None,
            "sitename": value("sitename"),
            "pH": value("pH"),
            "water_table_depth": value("water_table_depth"),
            "dominant_genus": str(dominant.loc[sampleid]),
            "highlight": "target" if sampleid == target_id else "analogue" if int(sampleid) in analogue_ids else None,
        })

    return {
        "method": f"{dimensions}D non-metric multidimensional scaling of Bray-Curtis dissimilarities",
        "dimensions": dimensions,
        "stress": stress,
        "stress_kind": stress_kind,
        "iterations": int(getattr(model, "n_iter_", 0)),
        "converged": int(getattr(model, "n_iter_", 500)) < 500,
        "sample_count": len(matrix),
        "genus_count": matrix.shape[1],
        "removed_genus_count": original_genus_count - matrix.shape[1],
        "sampled": sampled,
        "available_sample_count": len(available_ids),
        "prevalence": request.prevalence,
        "random_seed": request.random_seed,
        "n_init": max(1, min(request.n_init, 20)),
        "sampling_method": "site-stratified round-robin" if sampled else "all eligible samples",
        "stress_by_dimension": stress_by_dimension,
        "target_sampleid": target_id,
        "shepard": {
            "bray_curtis": condensed_distances[pair_indexes].astype(float).tolist(),
            "ordination_distance": ordination_distances[pair_indexes].astype(float).tolist(),
            "monotonic_disparity": monotonic_disparities[pair_indexes].astype(float).tolist(),
        },
        "renormalized_after_filtering": True,
        "sensitivity": {
            "initializations": initialization_sensitivity,
            "prevalence": prevalence_sensitivity,
        },
        "points": points,
    }


@app.post("/taxa/sample-profiles")
def taxa_sample_profiles(request: SampleProfilesRequest):
    ids = list(dict.fromkeys(request.sampleids))[:1000]
    group_limit = max(2, min(request.limit, 100))
    selected = (
        genus_profiles_df[genus_profiles_df["sampleid"].isin(ids)].copy()
        if request.level == "genus"
        else taxa_df[taxa_df["sampleid"].isin(ids)].copy()
    )

    if selected.empty:
        return []

    profiles = []
    grouped = {int(sampleid): sample for sampleid, sample in selected.groupby("sampleid")}
    for sampleid in ids:
        sample = grouped.get(sampleid)
        if sample is None:
            continue
        if request.level == "genus":
            composition = sample[["lumped_taxon", "percentage"]].to_dict(orient="records")
            for row in composition:
                row["abundance"] = row["percentage"]
            composition = limit_taxa_groups(composition, group_limit)
        else:
            composition = limit_taxa_groups(
                compute_taxa_lumping(sample, request.level),
                group_limit,
            )
        dominant = next(
            (row["lumped_taxon"] for row in composition if row["lumped_taxon"] != "Other"),
            "Unknown",
        )
        profiles.append({
            "sampleid": sampleid,
            "dominant_genus": dominant,
            "composition": composition,
        })

    return profiles


@app.get("/search")
def search(
    ph_min: float | None = None,
    ph_max: float | None = None,

    water_min: float | None = None,
    water_max: float | None = None,

    lat_min: float | None = None,
    lat_max: float | None = None,

    lon_min: float | None = None,
    lon_max: float | None = None,

    site_contains: str | None = None,
    publication_contains: str | None = None,
):

    result = df.copy()

    if ph_min is not None:
        result = result[result["pH"] >= ph_min]

    if ph_max is not None:
        result = result[result["pH"] <= ph_max]

    if water_min is not None:
        result = result[result["water_table_depth"] >= water_min]

    if water_max is not None:
        result = result[result["water_table_depth"] <= water_max]

    if site_contains:
        result = result[
            result["sitename"].str.contains(
                site_contains,
                case=False,
                na=False,
            )
        ]

    if publication_contains:
        query = publication_contains.strip()
        result = result[
            result["doi"].astype(str).str.contains(query, case=False, na=False)
        ]

    result = result.copy()

    if result.empty:
        return []

    if "geography" in result.columns:
        coords = result["geography"].apply(get_lon_lat)
        result["longitude"] = coords.apply(lambda x: x[0])
        result["latitude"] = coords.apply(lambda x: x[1])
    else:
        result["longitude"] = None
        result["latitude"] = None

    if lat_min is not None:
        result = result[
            result["latitude"] >= lat_min
        ]

    if lat_max is not None:
        result = result[
            result["latitude"] <= lat_max
        ]

    if lon_min is not None:
        result = result[
            result["longitude"] >= lon_min
        ]

    if lon_max is not None:
        result = result[
            result["longitude"] <= lon_max
        ]

    cols = [
        "datasetid",
        "siteid",
        "sitename",
        "collectionunit",
        "handle",
        "sampleid",
        "pH",
        "water_table_depth",
        "water_table_depth_units",
        "altitude",
        "latitude",
        "longitude",
        "doi",
        "investigators",
    ]

    cols = [c for c in cols if c in result.columns]

    output = result[cols].head(5000).copy()

    # CRITICAL FIX
    output = output.astype(object)
    output = output.where(pd.notnull(output), None)

    records = output.to_dict(orient="records")

    print(f"Returning {len(records)} rows")

    return records
