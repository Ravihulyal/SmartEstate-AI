
import joblib
import pandas as pd

# Load model
model = joblib.load("artifacts/fraud_model.joblib")

# Test property
property_data = pd.DataFrame([{
    "total_sqft": 1200,
    "bhk": 2,
    "bath": 2,
    "price": 65,
    "price_per_sqft": (65 * 100000) / 1200
}])

# Predict
result = model.predict(property_data)

print("Property Analysis")
print("------------------------")

if result[0] == -1:
    print("Warning: Unusual property listing detected!")
    print("Status: Suspicious")
else:
    print("No unusual pattern detected.")
    print("Status: Normal")

print("Anomaly signals are for review only and do not prove fraud.")
