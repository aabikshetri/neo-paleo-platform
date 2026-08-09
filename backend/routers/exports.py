from fastapi import APIRouter

from backend.handlers import explorer

router = APIRouter(prefix="/export", tags=["exports"])
router.add_api_route("/taxa-csv", explorer.export_taxa_csv, methods=["POST"])
