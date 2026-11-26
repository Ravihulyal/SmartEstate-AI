
import pandas as pd
import joblib
import os

from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.ensemble import RandomForestRegressor
from sklearn.pipeline import Pipeline
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

# Load cleaned dataset
df = pd.read_csv("datasets/properties_cleaned.csv")

# Select input features
X = df[["location", "total_sqft", "bhk", "bath"]]

# Target variable
y = df["price"]

# Separate categorical and numerical columns
categorical_features = ["location"]
numerical_features = ["total_sqft", "bhk", "bath"]

# Preprocessing
preprocessor = ColumnTransformer(
    transformers=[
        ("location", OneHotEncoder(handle_unknown="ignore"), categorical_features),
        ("numbers", "passthrough", numerical_features)
    ]
)

# Random Forest model
random_forest = RandomForestRegressor(
    n_estimators=150,
    max_depth=20,
    min_samples_split=5,
    random_state=42,
    n_jobs=-1
)

# Complete ML pipeline
model = Pipeline([
    ("preprocessor", preprocessor),
    ("regressor", random_forest)
])

# Split dataset
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

# Train model
print("Training Random Forest model...")
model.fit(X_train, y_train)

# Predictions
predictions = model.predict(X_test)

# Evaluation
mae = mean_absolute_error(y_test, predictions)
mse = mean_squared_error(y_test, predictions)
rmse = mse ** 0.5
r2 = r2_score(y_test, predictions)

print("\nModel Evaluation")
print("-------------------------")
print("MAE:", round(mae, 2), "Lakhs")
print("RMSE:", round(rmse, 2), "Lakhs")
print("R2 Score:", round(r2, 4))

# Save trained model
os.makedirs("artifacts", exist_ok=True)

joblib.dump(model, "artifacts/price_model.joblib")

print("\nModel trained and saved successfully!")
print("Saved at: artifacts/price_model.joblib")
