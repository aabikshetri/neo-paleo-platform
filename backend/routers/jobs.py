from fastapi import APIRouter

from backend.jobs import cancel_job, job_status, submit_analogue, submit_nmds
from backend.schemas.requests import AnalogueRequest, NmdsRequest

router = APIRouter(prefix="/jobs", tags=["jobs"])
router.add_api_route("/nmds", submit_nmds, methods=["POST"])
router.add_api_route("/modern-analogues", submit_analogue, methods=["POST"])
router.add_api_route("/{job_id}", job_status, methods=["GET"])
router.add_api_route("/{job_id}", cancel_job, methods=["DELETE"])
