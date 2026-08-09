from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class SelectionRequest(BaseModel):
    sampleids: list[int] = Field(default_factory=list)
    selection_token: Optional[str] = None


class TaxaAggregateRequest(SelectionRequest):
    level: str = "taxon"
    limit: int = 25


class SampleProfilesRequest(SelectionRequest):
    level: str = "taxon"
    limit: int = 8


class TaxonValuesRequest(SelectionRequest):
    taxa: list[str]


class CalibrationRequest(SelectionRequest):
    pass


class AnalogueRequest(BaseModel):
    target_sampleid: int
    calibration_sampleids: list[int] = Field(default_factory=list)
    selection_token: Optional[str] = None
    limit: int = 10
    exclude_same_site: bool = True
    exclude_same_doi: bool = True


class NmdsRequest(SelectionRequest):
    max_samples: int = 500
    prevalence: float = 0.02
    random_seed: int = 42
    n_init: int = 10
    dimensions: int = 2
    target_sampleid: Optional[int] = None
    run_sensitivity: bool = False
