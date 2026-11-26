
from app.models.recommend_model import recommend_properties

recommendations = recommend_properties(
    location="Whitefield",
    budget=80,
    bhk=2,
    area=1200,
    top_n=5
)

print("\nRecommended Properties")
print("============================")

for index, property in enumerate(recommendations, start=1):

    print(f"\nRecommendation {index}")
    print("Location:", property["location"])
    print("Area:", property["total_sqft"], "sqft")
    print("Bedrooms:", property["bhk"])
    print("Bathrooms:", property["bath"])
    print("Price:", property["price"], "Lakhs")
    print(
        "Match Score:",
        round(property["recommendation_score"] * 100, 2),
        "%"
    )
