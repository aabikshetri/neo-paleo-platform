from fastapi import APIRouter

from backend.handlers import explorer

router = APIRouter(prefix="/calibration", tags=["calibration"])
router.add_api_route("/quality", explorer.calibration_quality, methods=["POST"])
router.add_api_route("/modern-analogues", explorer.modern_analogues, methods=["POST"])
