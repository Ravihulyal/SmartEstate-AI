
import pandas as pd
import numpy as np
import re

# Load original dataset
df = pd.read_csv("datasets/bengaluru_house_prices.csv")

print("Original dataset shape:", df.shape)

# Remove unnecessary columns
df = df.drop(columns=["area_type", "availability", "society", "balcony"], errors="ignore")

# Remove rows with missing important values
df = df.dropna(subset=["location", "size", "total_sqft", "bath", "price"])

# Convert BHK into numeric values
def extract_bhk(value):
    match = re.search(r"\d+", str(value))
    return int(match.group()) if match else np.nan

df["bhk"] = df["size"].apply(extract_bhk)

# Convert total_sqft ranges into average values
def convert_sqft(value):
    try:
        value = str(value).strip()

        if "-" in value:
            parts = value.split("-")
            return (float(parts[0]) + float(parts[1])) / 2

        return float(value)

    except:
        return np.nan

df["total_sqft"] = df["total_sqft"].apply(convert_sqft)

# Convert numeric columns
df["bath"] = pd.to_numeric(df["bath"], errors="coerce")
df["price"] = pd.to_numeric(df["price"], errors="coerce")

# Remove invalid values
df = df.dropna(subset=["bhk", "total_sqft", "bath", "price"])

# Keep realistic property records
df = df[
    (df["total_sqft"] > 200) &
    (df["bhk"] > 0) &
    (df["bhk"] <= 10) &
    (df["bath"] > 0) &
    (df["price"] > 0)
]

# Remove extra spaces from locations
df["location"] = df["location"].astype(str).str.strip()

# Create price per square foot feature
df["price_per_sqft"] = (df["price"] * 100000) / df["total_sqft"]

# Remove extreme price-per-square-foot outliers
lower = df["price_per_sqft"].quantile(0.01)
upper = df["price_per_sqft"].quantile(0.99)

df = df[
    (df["price_per_sqft"] >= lower) &
    (df["price_per_sqft"] <= upper)
]

# Remove duplicate records
df = df.drop_duplicates()

# Save cleaned dataset
df.to_csv("datasets/properties_cleaned.csv", index=False)

print("\nDataset cleaning completed!")
print("Cleaned dataset shape:", df.shape)
print("\nFinal columns:")
print(df.columns.tolist())

print("\nFirst 5 cleaned records:")
print(df.head())

print("\nSaved as datasets/properties_cleaned.csv")
