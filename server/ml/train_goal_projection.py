"""Train a global model to predict next-month savings from rolling 3-month history.

Outputs:
- goal_projection.joblib (model + metadata)
- goal_projection_metrics.json (training metrics)
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
from joblib import dump
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score, f1_score, precision_score, recall_score, accuracy_score
from sklearn.pipeline import Pipeline

ROOT = Path(__file__).resolve().parents[2]
SYNTHETIC_PATH = Path(__file__).resolve().parent / "synthetic_goal_training.csv"
DATA_PATH = ROOT / "simulated_bank_statement_enriched.csv"
MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_PATH = MODEL_DIR / "goal_projection.joblib"
METRICS_PATH = MODEL_DIR / "goal_projection_metrics.json"

FEATURE_COLUMNS = [
    "prev3_avg_savings",
    "prev3_std_savings",
    "prev3_trend",
    "prev3_avg_income",
    "prev3_avg_expense",
    "prev3_avg_txn_count",
    "prev3_income_ratio",
    "prev3_expense_ratio",
    "prev3_income_std",
    "prev3_expense_std",
    "prev3_savings_std",
    "lag1_savings",
    "lag2_savings",
    "month_num",
    "month_sin",
    "month_cos",
]


@dataclass
class TrainingSet:
    features: pd.DataFrame
    targets: pd.Series
    baseline: pd.Series
    groups: pd.Series


def load_transactions(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["Transaction_Date"] = pd.to_datetime(df["Transaction_Date"], errors="coerce")
    df = df.dropna(subset=["Transaction_Date", "Transaction_Amount", "Transaction_Type", "Month"])
    return df


def load_synthetic_training(path: Path) -> TrainingSet:
    df = pd.read_csv(path)
    required = set(FEATURE_COLUMNS + ["target_savings_ratio", "required_monthly"])
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"Synthetic dataset missing columns: {', '.join(sorted(missing))}")

    features_df = df[FEATURE_COLUMNS].copy()
    targets_series = df["target_savings_ratio"].copy()
    baseline_series = df["required_monthly"].copy()
    groups_series = df["user_id"].copy() if "user_id" in df.columns else pd.Series(range(len(df)))
    return TrainingSet(features_df, targets_series, baseline_series, groups_series)


def build_monthly_aggregates(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["Month"] = df["Month"].astype(str)
    df["is_income"] = df["Transaction_Type"].str.lower().eq("income")
    df["is_expense"] = df["Transaction_Type"].str.lower().eq("expense")

    grouped = (
        df.groupby(["Month"], as_index=False)
        .agg(
            income=("Transaction_Amount", lambda x: x[df.loc[x.index, "is_income"]].sum()),
            expense=("Transaction_Amount", lambda x: x[df.loc[x.index, "is_expense"]].sum()),
            txn_count=("Transaction_Amount", "count"),
        )
        .sort_values("Month")
        .reset_index(drop=True)
    )
    grouped["savings"] = grouped["income"] - grouped["expense"]
    grouped["total_flow"] = grouped["income"] + grouped["expense"]
    grouped["income_ratio"] = grouped.apply(
        lambda row: row["income"] / row["total_flow"] if row["total_flow"] > 0 else 0,
        axis=1,
    )
    grouped["expense_ratio"] = grouped.apply(
        lambda row: row["expense"] / row["total_flow"] if row["total_flow"] > 0 else 0,
        axis=1,
    )
    grouped["month_num"] = grouped["Month"].str.slice(5, 7).astype(int)
    grouped["month_sin"] = np.sin(2 * np.pi * grouped["month_num"] / 12)
    grouped["month_cos"] = np.cos(2 * np.pi * grouped["month_num"] / 12)
    return grouped


def build_training_set(monthly: pd.DataFrame) -> TrainingSet:
    rows: List[Dict[str, float]] = []
    targets: List[float] = []
    baselines: List[float] = []
    groups: List[str] = []

    monthly_sorted = monthly.sort_values("Month").reset_index(drop=True)
    if len(monthly_sorted) < 4:
        return TrainingSet(pd.DataFrame(), pd.Series(dtype=float), pd.Series(dtype=float), pd.Series(dtype=str))

    for idx in range(3, len(monthly_sorted)):
        history = monthly_sorted.iloc[idx - 3 : idx]
        current = monthly_sorted.iloc[idx]

        prev3_avg_savings = history["savings"].mean()
        prev3_std_savings = history["savings"].std(ddof=0)
        prev3_avg_income = history["income"].mean()
        prev3_avg_expense = history["expense"].mean()
        prev3_avg_txn_count = history["txn_count"].mean()
        prev3_income_ratio = history["income_ratio"].mean()
        prev3_expense_ratio = history["expense_ratio"].mean()

        features = {
            "prev3_avg_savings": prev3_avg_savings,
            "prev3_std_savings": prev3_std_savings,
            "prev3_avg_income": prev3_avg_income,
            "prev3_avg_expense": prev3_avg_expense,
            "prev3_avg_txn_count": prev3_avg_txn_count,
            "prev3_income_ratio": prev3_income_ratio,
            "prev3_expense_ratio": prev3_expense_ratio,
            "month_num": current["month_num"],
            "month_sin": current["month_sin"],
            "month_cos": current["month_cos"],
        }
        rows.append(features)
        targets.append(current["savings"])
        baselines.append(prev3_avg_savings)
        groups.append(current["Month"])

    features_df = pd.DataFrame(rows)
    targets_series = pd.Series(targets)
    baseline_series = pd.Series(baselines)
    groups_series = pd.Series(groups)
    return TrainingSet(features_df, targets_series, baseline_series, groups_series)


def train_model(dataset: TrainingSet) -> Tuple[Pipeline, Dict[str, float], float]:
    total = len(dataset.features)
    split_index = max(1, int(total * 0.8))

    X_train = dataset.features.iloc[:split_index]
    y_train = dataset.targets.iloc[:split_index]
    X_test = dataset.features.iloc[split_index:]
    y_test = dataset.targets.iloc[split_index:]
    baseline_test = dataset.baseline.iloc[split_index:]

    model = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            (
                "regressor",
                GradientBoostingRegressor(
                    random_state=42,
                    n_estimators=200,
                    max_depth=3,
                    learning_rate=0.05,
                    subsample=0.9,
                ),
            ),
        ]
    )

    model.fit(X_train, y_train)
    predictions = model.predict(X_test)
    predictions = np.clip(predictions, -1.0, 1.0)

    avg_income = X_test["prev3_avg_income"].to_numpy()
    actual_savings = y_test.to_numpy() * avg_income
    predicted_savings = predictions * avg_income

    mae = mean_absolute_error(actual_savings, predicted_savings)
    rmse = float(mean_squared_error(actual_savings, predicted_savings) ** 0.5)
    r2 = r2_score(actual_savings, predicted_savings)
    residual_std = float(np.std(y_test - predictions))

    # Classification: did savings meet or beat the recent 3-month average?
    y_true_class = (y_test >= baseline_test).astype(int)
    y_pred_class = (predicted_savings >= baseline_test).astype(int)
    y_true_class = (actual_savings >= baseline_test).astype(int)

    metrics = {
        "mae": float(mae),
        "rmse": float(rmse),
        "r2": float(r2),
        "f1": float(f1_score(y_true_class, y_pred_class)),
        "precision": float(precision_score(y_true_class, y_pred_class)),
        "recall": float(recall_score(y_true_class, y_pred_class)),
        "accuracy": float(accuracy_score(y_true_class, y_pred_class)),
    }

    return model, metrics, residual_std


def main() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if SYNTHETIC_PATH.exists():
        dataset = load_synthetic_training(SYNTHETIC_PATH)
    else:
        df = load_transactions(DATA_PATH)
        monthly = build_monthly_aggregates(df)
        dataset = build_training_set(monthly)

    if dataset.features.empty:
        raise RuntimeError("Not enough data to train the model.")

    model, metrics, residual_std = train_model(dataset)

    payload = {
        "model": model,
        "feature_columns": FEATURE_COLUMNS,
        "residual_std": residual_std,
        "metrics": metrics,
    }

    dump(payload, MODEL_PATH)
    METRICS_PATH.write_text(json.dumps(metrics, indent=2))

    print("Model saved to", MODEL_PATH)
    print("Metrics saved to", METRICS_PATH)
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
