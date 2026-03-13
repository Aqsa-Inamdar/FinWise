#!/usr/bin/env python3
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.metrics import accuracy_score, average_precision_score, f1_score, precision_score, recall_score, roc_auc_score

BASE_DIR = Path(__file__).resolve().parent
ARCHIVE_DIR = BASE_DIR / "models" / "archive (5)"
ARTIFACT_DIR = ARCHIVE_DIR / "artifacts_goal"
TX_PATH = ARCHIVE_DIR / "transactions_data.csv"
USERS_PATH = ARCHIVE_DIR / "users_data.csv"
OUT_MODEL = ARTIFACT_DIR / "goal_classification_lightgbm.pkl"
OUT_METRICS = ARTIFACT_DIR / "goal_classification_runtime_metrics.json"
OUT_FEATURES = ARTIFACT_DIR / "goal_classification_runtime_feature_cols.joblib"

LOOKBACK = 6
HORIZON = 6
SEED = 42
MAX_TX_ROWS = 4_000_000
MAX_USERS = 5_000

RUNTIME_FEATURE_COLS = [
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
    "remaining_amount",
    "months_left",
    "required_monthly",
    "target_savings_ratio",
]


def parse_money(series: pd.Series) -> pd.Series:
    return (
        series.astype(str)
        .str.replace("$", "", regex=False)
        .str.replace(",", "", regex=False)
        .replace({"nan": np.nan, "None": np.nan})
        .astype(float)
    )


def load_data() -> tuple[pd.DataFrame, pd.DataFrame]:
    tx = pd.read_csv(TX_PATH, nrows=MAX_TX_ROWS)
    users = pd.read_csv(USERS_PATH)

    tx["date"] = pd.to_datetime(tx["date"], errors="coerce", utc=True)
    tx = tx.dropna(subset=["date", "client_id", "amount"])
    tx["amount_num"] = parse_money(tx["amount"]).fillna(0.0)
    # Expenses dominate this card transaction dataset. Use absolute spend magnitude.
    tx["spend"] = tx["amount_num"].abs()
    tx["month"] = tx["date"].dt.to_period("M").dt.to_timestamp().dt.tz_localize(None)

    users = users.rename(columns={"id": "client_id"}).copy()
    users["yearly_income"] = parse_money(users["yearly_income"]).fillna(0.0)
    users["monthly_income"] = users["yearly_income"] / 12.0
    users["total_debt"] = parse_money(users["total_debt"]).fillna(0.0)

    tx_clients = pd.Index(sorted(tx["client_id"].unique()))
    keep_clients = tx_clients[:MAX_USERS]
    tx = tx[tx["client_id"].isin(keep_clients)].copy()
    users = users[users["client_id"].isin(keep_clients)].copy()
    return tx, users


def build_monthly_panel(tx: pd.DataFrame, users: pd.DataFrame) -> pd.DataFrame:
    monthly = tx.groupby(["client_id", "month"], as_index=False).agg(
        spend=("spend", "sum"),
        txn_count=("id", "count"),
    )
    df = monthly.merge(
        users[["client_id", "monthly_income", "total_debt", "credit_score", "num_credit_cards", "current_age", "retirement_age"]],
        on="client_id",
        how="left",
    )
    df["monthly_income"] = df["monthly_income"].fillna(0.0)
    df["spend"] = df["spend"].fillna(0.0)
    df["txn_count"] = df["txn_count"].fillna(0.0)
    df["net_savings"] = df["monthly_income"] - df["spend"]
    df = df.sort_values(["client_id", "month"]).reset_index(drop=True)
    return df


def build_runtime_snapshot_table(df: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict] = []
    for client_id, g in df.groupby("client_id"):
        g = g.sort_values("month").reset_index(drop=True)
        n = len(g)
        if n < LOOKBACK + HORIZON:
            continue

        for i in range(LOOKBACK - 1, n - HORIZON):
            hist = g.iloc[i - LOOKBACK + 1 : i + 1]
            fut = g.iloc[i + 1 : i + 1 + HORIZON]

            future_cum = float(fut["net_savings"].sum())
            current_age = float(g.iloc[i]["current_age"])
            retirement_age = float(g.iloc[i]["retirement_age"])
            total_debt = float(g.iloc[i]["total_debt"])
            months_to_ret = max(1.0, (retirement_age - current_age) * 12.0)
            required_monthly = total_debt / months_to_ret
            required_amount_h = required_monthly * HORIZON
            achievable = int(future_cum >= required_amount_h)

            spend_vals = hist["spend"].to_numpy(dtype=float)
            net_vals = hist["net_savings"].to_numpy(dtype=float)
            income_vals = hist["monthly_income"].to_numpy(dtype=float)
            txn_vals = hist["txn_count"].to_numpy(dtype=float)
            snapshot_month = pd.Timestamp(g.iloc[i]["month"])
            month_num = int(snapshot_month.month)

            prev3_avg_savings = float(np.mean(net_vals[-3:]))
            row = {
                "client_id": int(client_id),
                "snapshot_month": snapshot_month,
                "prev3_avg_savings": prev3_avg_savings,
                "prev3_std_savings": float(np.std(net_vals[-3:], ddof=1)) if len(net_vals[-3:]) > 1 else 0.0,
                "prev3_trend": float(net_vals[-1] - net_vals[-3]),
                "prev3_avg_income": float(np.mean(income_vals[-3:])),
                "prev3_avg_expense": float(np.mean(spend_vals[-3:])),
                "prev3_avg_txn_count": float(np.mean(txn_vals[-3:])),
                "prev3_income_ratio": float(np.mean(np.divide(income_vals[-3:], income_vals[-3:] + spend_vals[-3:], out=np.zeros(3), where=(income_vals[-3:] + spend_vals[-3:]) != 0))),
                "prev3_expense_ratio": float(np.mean(np.divide(spend_vals[-3:], income_vals[-3:] + spend_vals[-3:], out=np.zeros(3), where=(income_vals[-3:] + spend_vals[-3:]) != 0))),
                "prev3_income_std": float(np.std(income_vals[-3:], ddof=1)) if len(income_vals[-3:]) > 1 else 0.0,
                "prev3_expense_std": float(np.std(spend_vals[-3:], ddof=1)) if len(spend_vals[-3:]) > 1 else 0.0,
                "prev3_savings_std": float(np.std(net_vals[-3:], ddof=1)) if len(net_vals[-3:]) > 1 else 0.0,
                "lag1_savings": float(net_vals[-1]),
                "lag2_savings": float(net_vals[-2]),
                "month_num": month_num,
                "month_sin": float(np.sin((2 * np.pi * month_num) / 12)),
                "month_cos": float(np.cos((2 * np.pi * month_num) / 12)),
                "remaining_amount": float(required_amount_h),
                "months_left": float(HORIZON),
                "required_monthly": float(required_monthly),
                "target_savings_ratio": float(prev3_avg_savings / required_monthly) if required_monthly > 0 else 0.0,
                "future_cum_net_savings_h": future_cum,
                "achievable_by_deadline_h": achievable,
            }
            rows.append(row)

    snap = pd.DataFrame(rows)
    snap = snap.replace([np.inf, -np.inf], np.nan).dropna(subset=RUNTIME_FEATURE_COLS + ["achievable_by_deadline_h", "snapshot_month"])
    return snap


def train_and_export(snap: pd.DataFrame) -> None:
    split_month = snap["snapshot_month"].quantile(0.8)
    train_df = snap[snap["snapshot_month"] <= split_month].copy()
    test_df = snap[snap["snapshot_month"] > split_month].copy()

    X_train = train_df[RUNTIME_FEATURE_COLS]
    y_train = train_df["achievable_by_deadline_h"]
    X_test = test_df[RUNTIME_FEATURE_COLS]
    y_test = test_df["achievable_by_deadline_h"]

    model = LGBMClassifier(
        n_estimators=300,
        learning_rate=0.05,
        num_leaves=31,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=SEED,
    )
    model.fit(X_train, y_train)
    proba = model.predict_proba(X_test)[:, 1]
    pred = (proba >= 0.41).astype(int)

    metrics = {
        "trained_rows": int(len(train_df)),
        "test_rows": int(len(test_df)),
        "feature_cols": RUNTIME_FEATURE_COLS,
        "positive_rate_train": float(y_train.mean()),
        "positive_rate_test": float(y_test.mean()),
        "Accuracy": float(accuracy_score(y_test, pred)),
        "Precision": float(precision_score(y_test, pred, zero_division=0)),
        "Recall": float(recall_score(y_test, pred, zero_division=0)),
        "F1": float(f1_score(y_test, pred, zero_division=0)),
        "AUC": float(roc_auc_score(y_test, proba)),
        "PR_AUC": float(average_precision_score(y_test, proba)),
        "split_month": str(pd.Timestamp(split_month).date()),
        "notes": "Runtime-aligned classifier trained on exact production goal feature schema.",
    }

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, OUT_MODEL)
    joblib.dump(RUNTIME_FEATURE_COLS, OUT_FEATURES)
    OUT_METRICS.write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics, indent=2))
    print(f"Saved classifier artifact to {OUT_MODEL}")


if __name__ == "__main__":
    tx, users = load_data()
    panel = build_monthly_panel(tx, users)
    snap = build_runtime_snapshot_table(panel)
    if snap.empty:
        raise SystemExit("Runtime snapshot table is empty. Cannot train classifier.")
    train_and_export(snap)
