
import pandas as pd
import numpy as np
import joblib
import os

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report, confusion_matrix

# Load cleaned dataset
df = pd.read_csv("datasets/properties_cleaned.csv")

# Calculate median price per sqft for each location
location_medians = df.groupby("location")["price_per_sqft"].median()
global_median = df["price_per_sqft"].median()

# Calculate price ratio compared to the location median
df["location_median"] = df["location"].map(location_medians)
df["location_median"] = df["location_median"].fillna(global_median)

df["price_ratio"] = (
    df["price_per_sqft"] / df["location_median"]
)

# Calculate additional features
df["sqft_per_bhk"] = df["total_sqft"] / df["bhk"]
df["bath_per_bhk"] = df["bath"] / df["bhk"]

# Generate demonstration risk labels using rules
df["risk_label"] = (
    (df["price_ratio"] > 2.0) |
    (df["price_ratio"] < 0.5) |
    (df["sqft_per_bhk"] < 250) |
    (df["sqft_per_bhk"] > 1500) |
    (df["bath"] > df["bhk"] + 2)
).astype(int)

# Select input features
features = [
    "price_ratio",
    "sqft_per_bhk",
    "bath_per_bhk"
]

X = df[features]
y = df["risk_label"]

print("Risk label distribution:")
print(y.value_counts())

# Split dataset
X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.2,
    random_state=42,
    stratify=y
)

# Create Logistic Regression pipeline
model = Pipeline([
    ("scaler", StandardScaler()),
    ("classifier", LogisticRegression(
        max_iter=1000,
        class_weight="balanced"
    ))
])

# Train model
print("\nTraining Logistic Regression...")
model.fit(X_train, y_train)

# Evaluate model
predictions = model.predict(X_test)

print("\nClassification Report:")
print(classification_report(
    y_test,
    predictions,
    target_names=["Normal", "High Risk"],
    zero_division=0
))

print("\nConfusion Matrix:")
print(confusion_matrix(y_test, predictions))

# Save model and location statistics
os.makedirs("artifacts", exist_ok=True)

joblib.dump({
    "model": model,
    "location_medians": location_medians.to_dict(),
    "global_median": global_median
}, "artifacts/risk_model.joblib")

print("\nLogistic Regression model saved!")
print("Location: artifacts/risk_model.joblib")
