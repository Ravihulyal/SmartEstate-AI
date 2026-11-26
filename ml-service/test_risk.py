
import joblib
import pandas as pd

# Load trained model and location statistics
saved_data = joblib.load("artifacts/risk_model.joblib")

model = saved_data["model"]
location_medians = saved_data["location_medians"]
global_median = saved_data["global_median"]

# Sample property details
location = "Whitefield"
total_sqft = 1200
bhk = 2
bath = 2
price = 65

# Calculate price per sqft
price_per_sqft = (price * 100000) / total_sqft

# Get location median
location_median = location_medians.get(
    location,
    global_median
)

# Prepare model features
property_data = pd.DataFrame([{
    "price_ratio": price_per_sqft / location_median,
    "sqft_per_bhk": total_sqft / bhk,
    "bath_per_bhk": bath / bhk
}])

# Predict risk
prediction = model.predict(property_data)[0]
probability = model.predict_proba(property_data)[0][1]

print("Property Risk Analysis")
print("--------------------------")
print("Location:", location)
print("Area:", total_sqft, "sqft")
print("Bedrooms:", bhk)
print("Bathrooms:", bath)
print("Price:", price, "Lakhs")

print("\nRisk Classification:")

if prediction == 1:
    print("HIGH RISK")
else:
    print("NORMAL")

print("Predicted high-risk probability:",
      round(probability * 100, 2), "%")
