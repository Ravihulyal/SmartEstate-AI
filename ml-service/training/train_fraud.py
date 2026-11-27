
import pandas as pd
import joblib
import os

from sklearn.ensemble import IsolationForest
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

# Load cleaned dataset
df = pd.read_csv("datasets/properties_cleaned.csv")

# Features used for anomaly detection
features = [
    "total_sqft",
    "bhk",
    "bath",
    "price",
    "price_per_sqft"
]

X = df[features].copy()

# Handle missing or infinite values
X = X.replace([float("inf"), float("-inf")], float("nan"))
X = X.fillna(X.median())

# Split data
X_train, X_test = train_test_split(
    X,
    test_size=0.2,
    random_state=42
)

# Create Isolation Forest model
model = IsolationForest(
    n_estimators=150,
    contamination=0.05,
    random_state=42
)

# Train model
print("Training Isolation Forest...")
model.fit(X_train)

# Predict anomalies
predictions = model.predict(X_test)

# Convert predictions
# 1 = Normal
# -1 = Anomaly
anomaly_count = (predictions == -1).sum()
normal_count = (predictions == 1).sum()

print("\nModel Results")
print("------------------------")
print("Normal listings:", normal_count)
print("Suspicious listings:", anomaly_count)
print("Total tested:", len(X_test))
print("These are model-flagged unusual patterns, not verified fraud cases; accuracy is unavailable without ground-truth labels.")

# Save model
os.makedirs("artifacts", exist_ok=True)

joblib.dump(
    model,
    "artifacts/fraud_model.joblib"
)

print("\nIsolation Forest model saved successfully!")
