
import pandas as pd
from pathlib import Path
from functools import lru_cache


@lru_cache(maxsize=1)
def _load_clean_properties():
    base_dir = Path(__file__).resolve().parents[2]
    return pd.read_csv(base_dir / "datasets" / "properties_cleaned.csv")


def recommend_properties(
    location,
    budget,
    bhk,
    area,
    top_n=5
):
    # Load cleaned property dataset
    df = _load_clean_properties().copy()

    # Remove properties above the budget
    df = df[df["price"] <= budget].copy()

    # Return empty list if no properties match
    if df.empty:
        return []

    # Calculate location similarity
    df["location_score"] = (
        df["location"].str.lower() == location.lower()
    ).astype(float)

    # Calculate budget similarity
    df["budget_score"] = (
        1 - abs(df["price"] - budget) / max(budget, 1)
    ).clip(0, 1)

    # Calculate bedroom similarity
    df["bhk_score"] = (
        1 - abs(df["bhk"] - bhk) / max(bhk, 1)
    ).clip(0, 1)

    # Calculate area similarity
    df["area_score"] = (
        1 - abs(df["total_sqft"] - area) / max(area, 1)
    ).clip(0, 1)

    # Calculate final recommendation score
    df["recommendation_score"] = (
        0.40 * df["location_score"] +
        0.30 * df["budget_score"] +
        0.20 * df["bhk_score"] +
        0.10 * df["area_score"]
    )

    # Sort by recommendation score
    recommendations = df.sort_values(
        by="recommendation_score",
        ascending=False
    )

    # Return top recommendations
    result = recommendations.head(top_n)

    return result[
        [
            "location",
            "total_sqft",
            "bhk",
            "bath",
            "price",
            "recommendation_score"
        ]
    ].to_dict(orient="records")
