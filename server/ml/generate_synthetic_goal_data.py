"""Generate a realistic synthetic goal-completion dataset for training.

Outputs a CSV with rolling 3-month features, next-month savings target,
required monthly savings to meet goal, and goal metadata.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_PATH = Path(__file__).resolve().parent / "synthetic_goal_training.csv"


@dataclass
class UserProfile:
    user_id: str
    base_income: float
    expense_ratio: float
    volatility: float


def generate_month_series(months: List[pd.Timestamp]) -> pd.DataFrame:
    rng = np.random.default_rng(42)
    user_count = 5000
    users = [f"USER{str(i).zfill(4)}" for i in range(1, user_count + 1)]

    profiles = []
    for user in users:
        base_income = rng.normal(4500, 1200)
        expense_ratio = np.clip(rng.normal(0.75, 0.08), 0.5, 0.95)
        volatility = rng.uniform(0.05, 0.25)
        profiles.append(UserProfile(user, max(1800, base_income), expense_ratio, volatility))

    rows = []
    for profile in profiles:
        for idx, month in enumerate(months):
            seasonality = 1 + 0.08 * np.sin(2 * np.pi * (month.month / 12))
            income = profile.base_income * seasonality * rng.normal(1, profile.volatility)
            expense = income * profile.expense_ratio * rng.normal(1, profile.volatility)
            txn_count = int(np.clip(rng.normal(45, 12), 12, 120))
            savings = income - expense
            rows.append(
                {
                    "user_id": profile.user_id,
                    "month": month.strftime("%Y-%m"),
                    "month_num": month.month,
                    "income": max(0, income),
                    "expense": max(0, expense),
                    "txn_count": txn_count,
                    "savings": savings,
                }
            )
    return pd.DataFrame(rows)


def attach_goal_plan(monthly: pd.DataFrame) -> pd.DataFrame:
    rng = np.random.default_rng(7)
    output_rows = []

    for user_id, group in monthly.groupby("user_id"):
        group = group.sort_values("month").reset_index(drop=True)
        if len(group) < 12:
            continue

        goal_start_idx = rng.integers(3, len(group) - 6)
        goal_start_month = group.loc[goal_start_idx, "month"]
        deadline_idx = min(len(group) - 1, goal_start_idx + rng.integers(6, 12))
        deadline_month = group.loc[deadline_idx, "month"]

        avg_savings = group.loc[goal_start_idx - 3 : goal_start_idx - 1, "savings"].mean()
        target_amount = max(2000, avg_savings * rng.integers(6, 12))
        current_amount = max(0, avg_savings * rng.integers(1, 3))

        for idx in range(3, len(group)):
            history = group.iloc[idx - 3 : idx]
            current = group.iloc[idx]
            prev3_avg_savings = history["savings"].mean()
            prev3_std_savings = history["savings"].std(ddof=0)
            prev3_trend = history["savings"].iloc[-1] - history["savings"].iloc[0]
            prev3_avg_income = history["income"].mean()
            prev3_avg_expense = history["expense"].mean()
            prev3_avg_txn_count = history["txn_count"].mean()
            prev3_income_std = history["income"].std(ddof=0)
            prev3_expense_std = history["expense"].std(ddof=0)
            prev3_savings_std = history["savings"].std(ddof=0)
            lag1_savings = history["savings"].iloc[-1]
            lag2_savings = history["savings"].iloc[-2]

            prev3_income_ratio = prev3_avg_income / (prev3_avg_income + prev3_avg_expense)
            prev3_expense_ratio = prev3_avg_expense / (prev3_avg_income + prev3_avg_expense)

            month_num = int(current["month_num"])
            month_sin = np.sin(2 * np.pi * month_num / 12)
            month_cos = np.cos(2 * np.pi * month_num / 12)

            remaining = max(0, target_amount - current_amount)
            months_left = max(1, deadline_idx - idx)
            required_monthly = remaining / months_left

            target_ratio = (
                current["savings"] / prev3_avg_income if prev3_avg_income > 0 else 0
            )

            output_rows.append(
                {
                    "user_id": user_id,
                    "month": current["month"],
                    "goal_start_month": goal_start_month,
                    "deadline_month": deadline_month,
                    "target_amount": target_amount,
                    "current_amount": current_amount,
                    "remaining_amount": remaining,
                    "months_left": months_left,
                    "required_monthly": required_monthly,
                    "prev3_avg_savings": prev3_avg_savings,
                    "prev3_std_savings": prev3_std_savings,
                    "prev3_trend": prev3_trend,
                    "prev3_avg_income": prev3_avg_income,
                    "prev3_avg_expense": prev3_avg_expense,
                    "prev3_avg_txn_count": prev3_avg_txn_count,
                    "prev3_income_ratio": prev3_income_ratio,
                    "prev3_expense_ratio": prev3_expense_ratio,
                    "prev3_income_std": prev3_income_std,
                    "prev3_expense_std": prev3_expense_std,
                    "prev3_savings_std": prev3_savings_std,
                    "lag1_savings": lag1_savings,
                    "lag2_savings": lag2_savings,
                    "month_num": month_num,
                    "month_sin": month_sin,
                    "month_cos": month_cos,
                    "target_savings_ratio": target_ratio,
                }
            )

    return pd.DataFrame(output_rows)


def main() -> None:
    start = pd.Timestamp("2022-01-01")
    months = pd.date_range(start, periods=36, freq="MS")
    monthly = generate_month_series(list(months))
    dataset = attach_goal_plan(monthly)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    dataset.to_csv(OUTPUT_PATH, index=False)

    print("Wrote", OUTPUT_PATH)
    print("Rows", len(dataset))
    print(dataset.head())


if __name__ == "__main__":
    main()
