from fastapi import APIRouter

from backend.handlers import explorer

router = APIRouter(tags=["status"])
router.add_api_route("/", explorer.root, methods=["GET"])
router.add_api_route("/health", explorer.health, methods=["GET"])
router.add_api_route("/summary", explorer.summary, methods=["GET"])
router.add_api_route("/correlation", explorer.correlation, methods=["GET"])
router.add_api_route("/pca/environment", explorer.environmental_pca, methods=["GET"])
