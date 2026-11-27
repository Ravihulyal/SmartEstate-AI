import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


API_KEY = "test-api-key-for-authentication"
PRICE_INPUT = {
    "location": "Whitefield",
    "total_sqft": 1200,
    "bhk": 2,
    "bath": 2,
}
FRAUD_INPUT = {**PRICE_INPUT, "price": 65}
RECOMMENDATION_INPUT = {
    "location": "Whitefield",
    "budget": 100,
    "bhk": 2,
    "area": 1200,
    "top_n": 1,
}
PROTECTED_REQUESTS = (
    ("/predict-price", PRICE_INPUT),
    ("/detect-fraud", FRAUD_INPUT),
    ("/classify-risk", FRAUD_INPUT),
    ("/recommend", RECOMMENDATION_INPUT),
)


class ApiKeyAuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.api_key_patch = patch.dict(os.environ, {"ML_API_KEY": API_KEY})
        self.api_key_patch.start()
        self.client_context = TestClient(app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.api_key_patch.stop()

    def test_missing_and_incorrect_keys_are_rejected_for_all_protected_routes(self):
        for path, payload in PROTECTED_REQUESTS:
            with self.subTest(path=path, key="missing"):
                self.assertEqual(self.client.post(path, json=payload).status_code, 401)
            with self.subTest(path=path, key="incorrect"):
                response = self.client.post(
                    path,
                    json=payload,
                    headers={"X-API-Key": "incorrect-api-key"},
                )
                self.assertEqual(response.status_code, 401)

    def test_correct_key_allows_all_protected_routes(self):
        for path, payload in PROTECTED_REQUESTS:
            with self.subTest(path=path):
                response = self.client.post(
                    path,
                    json=payload,
                    headers={"X-API-Key": API_KEY},
                )
                self.assertEqual(response.status_code, 200)

    def test_health_endpoints_remain_public(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.client.get("/health").status_code, 200)

    def test_startup_fails_when_api_key_is_missing_or_empty(self):
        for value in (None, ""):
            with self.subTest(value=value):
                with patch.dict(os.environ, {}, clear=False):
                    if value is None:
                        os.environ.pop("ML_API_KEY", None)
                    else:
                        os.environ["ML_API_KEY"] = value
                    with self.assertRaisesRegex(RuntimeError, "ML_API_KEY"):
                        with TestClient(app):
                            pass


if __name__ == "__main__":
    unittest.main()
