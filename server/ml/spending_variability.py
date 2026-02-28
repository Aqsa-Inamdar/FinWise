"""Spending variability insight engine."""
from __future__ import annotations

import argparse
import json
from datetime import datetime
from typing import Dict, List, Tuple

import numpy as np

from firestore_service import fetch_historical_cvs, fetch_transactions, store_variability_insight


def aggregate_daily_spend(transactions: List[Dict]) -> Dict[str, float]:
    """Aggregate expense spend by date."""
    daily: Dict[str, float] = {}
    for txn in transactions:
        if txn.get("type") != "expense":
            continue
        date_value = txn.get("date")
        if not date_value:
            continue
        try:
            date_key = datetime.fromisoformat(date_value.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            continue
        amount = txn.get("amount")
        try:
            amount_value = abs(float(amount))
        except (TypeError, ValueError):
            continue
        daily[date_key] = daily.get(date_key, 0.0) + amount_value
    return daily


def compute_stats(values: List[float]) -> Dict[str, float]:
    """Compute summary stats for spending values."""
    array = np.array(values, dtype=float)
    mean = float(np.mean(array))
    std = float(np.std(array))
    return {
        "mean": mean,
        "std": std,
        "min": float(np.min(array)),
        "max": float(np.max(array)),
        "cv": float(std / mean) if mean > 0 else 0.0,
    }


def compute_thresholds(historical_cvs: List[float]) -> Tuple[float, float, str]:
    """Compute percentile thresholds or fallback to static values."""
    if historical_cvs:
        array = np.array(historical_cvs, dtype=float)
        low = float(np.percentile(array, 33))
        high = float(np.percentile(array, 66))
        return low, high, "historical_percentiles"
    return 0.25, 0.6, "bootstrap_threshold"


def classify_variability(cv: float, low: float, high: float) -> str:
    """Classify variability into LOW, MODERATE, HIGH."""
    if cv <= low:
        return "LOW"
    if cv >= high:
        return "HIGH"
    return "MODERATE"


def build_insight(variability: str, status: str) -> Dict:
    """Construct insight payload."""
    if status == "INSUFFICIENT_DATA":
        return {
            "id": "spending-variability",
            "type": "data_quality",
            "severity": "low",
            "title": "Not enough spending data yet",
            "message": "There isn't enough daily activity to assess spending consistency this month.",
            "recommendation": "Keep logging expenses to unlock this insight.",
        }

    if variability == "LOW":
        return {
            "id": "spending-variability",
            "type": "positive",
            "severity": "low",
            "title": "Spending was consistent day to day",
            "message": "Daily spending stayed within a narrow range this month.",
        }
    if variability == "HIGH":
        return {
            "id": "spending-variability",
            "type": "risk",
            "severity": "medium",
            "title": "Spending was highly variable",
            "message": "Daily spending fluctuated more than usual this month.",
            "recommendation": "Review large one-off expenses to keep cash flow steady.",
        }
    return {
        "id": "spending-variability",
        "type": "neutral",
        "severity": "low",
        "title": "Spending variability is moderate",
        "message": "Daily spending varied somewhat but stayed within your typical range.",
    }


def generate_variability_insight(user_id: str, month_key: str) -> Dict:
    """Generate the spending variability insight for a user-month."""
    transactions = fetch_transactions(user_id, month_key)
    daily_spend = aggregate_daily_spend(transactions)

    if len(daily_spend) < 7:
        insight = build_insight("MODERATE", "INSUFFICIENT_DATA")
        store_variability_insight(
            user_id,
            month_key,
            insight,
            {"status": "INSUFFICIENT_DATA", "days": len(daily_spend)},
            "insufficient_data",
        )
        return insight

    stats = compute_stats(list(daily_spend.values()))
    historical_cvs = fetch_historical_cvs(user_id)
    low, high, method = compute_thresholds(historical_cvs)
    variability = classify_variability(stats["cv"], low, high)
    insight = build_insight(variability, "OK")

    store_variability_insight(
        user_id,
        month_key,
        insight,
        {
            **stats,
            "days": len(daily_spend),
            "low_threshold": low,
            "high_threshold": high,
        },
        method,
    )

    return insight


def main() -> None:
    """CLI entrypoint."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--month", required=True)
    args = parser.parse_args()
    insight = generate_variability_insight(args.user_id, args.month)
    print(json.dumps(insight))


if __name__ == "__main__":
    main()
