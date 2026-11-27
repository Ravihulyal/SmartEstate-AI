import asyncio
import json
import unittest

from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from starlette.requests import Request

from app.main import PricePredictionInput, handle_request_validation_error


class RequestValidationErrorTests(unittest.TestCase):
    def test_non_finite_input_returns_serializable_422(self):
        with self.assertRaises(ValidationError) as raised:
            PricePredictionInput.model_validate({
                "location": "Whitefield",
                "total_sqft": float("inf"),
                "bhk": 2,
                "bath": 2
            })

        request = Request({"type": "http"})
        response = asyncio.run(handle_request_validation_error(
            request,
            RequestValidationError(raised.exception.errors())
        ))

        self.assertEqual(response.status_code, 422)
        detail = json.loads(response.body)["detail"]
        self.assertEqual(detail[0]["type"], "finite_number")
        self.assertNotIn("input", detail[0])


if __name__ == "__main__":
    unittest.main()
