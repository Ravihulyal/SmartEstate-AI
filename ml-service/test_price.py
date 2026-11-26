
import joblib
import pandas as pd

# Load trained model
model = joblib.load("artifacts/price_model.joblib")

# Sample property
property_data = pd.DataFrame([{
    "location": "Whitefield",
    "total_sqft": 1200,
    "bhk": 2,
    "bath": 2
}])

# Predict price
prediction = model.predict(property_data)

print("Property Details")
print("-------------------------")
print("Location: Whitefield")
print("Area: 1200 sqft")
print("Bedrooms: 2")
print("Bathrooms: 2")

print("\nEstimated Property Sale Price:")
print("INR", round(prediction[0], 2), "Lakhs")
