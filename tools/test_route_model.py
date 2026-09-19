"""Offline regressions for safe Jev response envelope handling."""
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
MODULE_PATH = Path(__file__).with_name("route-model.py")
SPEC = importlib.util.spec_from_file_location("route_model", MODULE_PATH)
route_model = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(route_model)


def native_result():
    answers = {}
    for key in route_model.SCORES:
        answers[key] = {"type": "score", "score": 1.0, "confidence": 0.9}
    for key in route_model.NOUL:
        answers[key] = {"type": "noul", "noul": 0.5}
    return {"answers": answers}


class CompactJevTests(unittest.TestCase):
    def test_accepts_native_result(self):
        self.assertEqual(route_model.compact_jev(native_result())["status"], "ok")

    def test_accepts_single_result_wrapper(self):
        wrapped = {"success": True, "result": native_result()}
        self.assertEqual(route_model.compact_jev(wrapped)["status"], "ok")

    def test_accepts_cloudflare_and_gateway_double_result_wrapper(self):
        wrapped = {
            "success": True,
            "errors": [],
            "messages": [],
            "result": {
                "gatewayMetadata": {"id": "offline-fixture"},
                "result": native_result(),
                "state": {},
            },
        }
        self.assertEqual(route_model.compact_jev(wrapped)["status"], "ok")

    def test_rejects_failure_markers_at_every_envelope_level(self):
        for depth in range(3):
            for marker in ({"success": False}, {"errors": ["failed"]}, {"error": "failed"}):
                with self.subTest(depth=depth, marker=tuple(marker)):
                    response = native_result()
                    for _ in range(depth):
                        response = {"success": True, "result": response}
                    response.update(marker)
                    self.assertEqual(route_model.compact_jev(response)["reason"], "upstream_error")

    def test_rejects_excessive_wrapping(self):
        response = native_result()
        for _ in range(route_model.MAX_JEV_RESULT_WRAPPERS + 1):
            response = {"result": response}
        self.assertEqual(route_model.compact_jev(response)["reason"], "invalid_response")

    def test_rejects_malformed_result_chain(self):
        for response in ({"result": None}, {"result": {"state": {}}}, []):
            with self.subTest(response_type=type(response).__name__):
                self.assertEqual(route_model.compact_jev(response)["reason"], "invalid_response")


if __name__ == "__main__":
    unittest.main()
