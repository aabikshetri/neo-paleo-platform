from fastapi import APIRouter

from backend.handlers import explorer

router = APIRouter(prefix="/taxa", tags=["taxa"])
router.add_api_route("/lumped", explorer.taxa_lumped, methods=["GET"])
router.add_api_route("/top", explorer.taxa_top, methods=["GET"])
router.add_api_route("/by-samples", explorer.taxa_by_samples, methods=["GET"])
router.add_api_route("/aggregate", explorer.taxa_aggregate, methods=["POST"])
router.add_api_route(
    "/composition-by-samples",
    explorer.taxa_composition_by_samples,
    methods=["GET"],
)
router.add_api_route("/sample-values", explorer.taxa_sample_values, methods=["POST"])
router.add_api_route("/sample-profiles", explorer.taxa_sample_profiles, methods=["POST"])
