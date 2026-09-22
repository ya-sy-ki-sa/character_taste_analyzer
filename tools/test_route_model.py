"""Offline regressions for safe Jev response envelope handling."""
import importlib.util
import json
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


def assessment(scores=None, confidence=0.9, noul=None):
    values = {key: 1.0 for key in route_model.SCORES}
    values.update(scores or {})
    return {
        "version": 1,
        "status": "ok",
        "scores": values,
        "confidence": {key: confidence for key in route_model.SCORES},
        "noul": {key: 0.5 for key in route_model.NOUL} | (noul or {}),
    }


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


class RoutingTests(unittest.TestCase):
    def test_legacy_weekly_quota_fields_are_rejected(self):
        for field, value in (("weekly_remaining_pct", 1), ("quota_observed_at", "2026-09-19T00:00:00Z")):
            with self.subTest(field=field), self.assertRaises(ValueError):
                route_model.validate_state({"task_summary": "test", field: value})

    def test_astra_uses_local_sol_and_jev_evidence_without_quota_fields(self):
        state = {
            "task_summary": "Unresolved architectural work",
            "unresolved": True,
            "sol_failures": 1,
            "sol_evidence": "Sol attempt could not resolve the cross-module decision.",
            "architectural_decision": True,
            "subsystems_involved": 2,
        }
        assessment_result = assessment(
            {
                "mechanical": 0.5,
                "ambiguity": 3.5,
                "reasoning_depth": 3.5,
                "architectural_scope": 3.5,
                "constraint_density": 3.5,
                "evidence_integration": 3.0,
                "output_complexity": 3.0,
                "language_nuance": 3.0,
                "failure_impact": 3.0,
            },
            noul={"tight_coupling": 0.95},
        )

        result = route_model.decide(route_model.validate_state(state), assessment_result)

        self.assertEqual(result["action"], "route")
        self.assertEqual(result["tier"], "astra")
        self.assertIn(result["candidate"], {"astra_low", "astra_medium", "astra_high", "astra_max"})
        self.assertTrue(result["astra_gate_passed"])
        self.assertNotIn("quota_status", result)

    def test_offline_routing_never_returns_hold(self):
        result = route_model.decide({"task_summary": "test"}, route_model.fallback("network_error"))
        self.assertEqual(result["action"], "route")
        self.assertNotIn("hold", result["action"])

    def test_low_demand_routes_to_luna_max(self):
        result = route_model.decide(
            route_model.validate_state({
                "task_summary": "Exact mechanical change",
                "cause_known": True,
                "implementation_plan_exists": True,
                "unresolved": False,
            }),
            assessment({"mechanical": 4.0, **{key: 0.0 for key in route_model.SCORES if key != "mechanical"}}, confidence=0.9),
        )
        self.assertEqual(result["candidate"], "luna_max")
        self.assertEqual(result["model"], "gpt-5.6-luna")
        self.assertEqual(result["reasoning_effort"], "max")

    def test_low_confidence_never_routes_below_sol_max(self):
        result = route_model.decide(
            route_model.validate_state({"task_summary": "Uncertain task"}),
            assessment({"mechanical": 4.0, **{key: 0.0 for key in route_model.SCORES if key != "mechanical"}}, confidence=0.5),
        )
        self.assertEqual(result["candidate"], "sol_max")

    def test_route_candidates_are_effort_ordered_and_questions_do_not_select_models(self):
        self.assertEqual(route_model.CANDIDATE_KEYS, (
            "luna_max", "sol_low", "sol_medium", "sol_high", "sol_max",
            "astra_low", "astra_medium", "astra_high", "astra_max",
        ))
        self.assertTrue(all(route_model.QUESTIONS[key]["type"] == "score" for key in route_model.SCORES))
        self.assertNotIn("model", json.dumps({key: route_model.QUESTIONS[key] for key in route_model.SCORES}))


if __name__ == "__main__":
    unittest.main()
