from fastapi import APIRouter

from backend.handlers import explorer

router = APIRouter(prefix="/calibration", tags=["ordination"])
router.add_api_route("/nmds", explorer.calibration_nmds, methods=["POST"])
