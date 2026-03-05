#!/usr/bin/env python3
import json
import sys
from pathlib import Path

import joblib
import numpy as np

BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models"

# LightGBM is the finalized production choice.
# Place exported artifacts at these paths.
REG_MODEL_CANDIDATES = [
    MODEL_DIR / "goal_regression_lightgbm.joblib",
    MODEL_DIR / "archive (5)" / "artifacts_goal" / "goal_regression_lightgbm.joblib",
]
REG_FEATURES_CANDIDATES = [
    MODEL_DIR / "goal_regression_feature_cols.joblib",
    MODEL_DIR / "archive (5)" / "artifacts_goal" / "goal_feature_cols.joblib",
]
CLS_MODEL_CANDIDATES = [
    MODEL_DIR / "goal_classification_lightgbm.pkl",
    MODEL_DIR / "archive (5)" / "artifacts_goal" / "goal_classification_lightgbm.pkl",
]


def _load_first_existing(paths):
    for path in paths:
        if path.exists():
            return path
    return None


def _safe_float(value):
    try:
        return float(value)
    except Exception:
        return 0.0


def _reg_value(col_name, features):
    if col_name in features:
        return _safe_float(features[col_name])

    # Compatibility mapping: notebook/server feature names -> artifact feature names.
    if col_name == "lag_1":
        return _safe_float(features.get("lag1_savings", 0.0))
    if col_name == "lag_2":
        return _safe_float(features.get("lag2_savings", 0.0))
    if col_name in ("lag_3", "lag_6", "roll3_mean", "roll6_mean"):
        return _safe_float(features.get("prev3_avg_savings", 0.0))
    if col_name in ("roll3_std", "roll6_std"):
        return _safe_float(features.get("prev3_std_savings", 0.0))
    if col_name == "month_num":
        return _safe_float(features.get("month_num", 1.0))
    if col_name == "quarter":
        m = int(_safe_float(features.get("month_num", 1.0)))
        return float(((m - 1) // 3) + 1)
    if col_name == "year_num":
        return 0.0
    if col_name in ("monthly_income", "total_debt", "credit_score", "num_credit_cards"):
        # Profile fields are unavailable in the current goal-page feature builder.
        return 0.0

    return 0.0


def _cls_value(col_name, features):
    if col_name in features:
        return _safe_float(features[col_name])

    # Common aliasing.
    aliases = {
        "remaining_amount": "remaining_amount",
        "months_left": "months_left",
        "required_monthly": "required_monthly",
        "prev3_avg_savings": "prev3_avg_savings",
        "prev3_std_savings": "prev3_std_savings",
        "prev3_trend": "prev3_trend",
        "prev3_avg_income": "prev3_avg_income",
        "prev3_avg_expense": "prev3_avg_expense",
        "prev3_income_std": "prev3_income_std",
        "prev3_expense_std": "prev3_expense_std",
        "lag1_savings": "lag1_savings",
        "lag2_savings": "lag2_savings",
        "target_savings_ratio": "target_savings_ratio",
        "month_sin": "month_sin",
        "month_cos": "month_cos",
    }
    mapped = aliases.get(col_name)
    if mapped:
        return _safe_float(features.get(mapped, 0.0))

    return 0.0


def _resolve_feature_columns(model, explicit_cols):
    if explicit_cols:
        return list(explicit_cols)

    name_in = getattr(model, "feature_names_in_", None)
    if name_in is not None and len(name_in) > 0:
        return list(name_in)

    lgbm_names = getattr(model, "feature_name_", None)
    if lgbm_names is not None and len(lgbm_names) > 0:
        return list(lgbm_names)

    return []


def _assert_model_type(model, expected_type_name, model_path):
    actual = type(model).__name__
    if actual != expected_type_name:
        raise ValueError(
            f"Expected {expected_type_name} but loaded {actual} from {model_path}. "
            "Export the finalized LightGBM artifacts and place them under server/ml/models/."
        )


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        features = payload.get("features", {})

        reg_model_path = _load_first_existing(REG_MODEL_CANDIDATES)
        reg_feature_cols_path = _load_first_existing(REG_FEATURES_CANDIDATES)
        if reg_model_path is None:
            raise FileNotFoundError(
                "LightGBM regression artifact missing. Expected: server/ml/models/goal_regression_lightgbm.joblib"
            )

        reg_model = joblib.load(reg_model_path)
        _assert_model_type(reg_model, "LGBMRegressor", reg_model_path)

        reg_cols = []
        if reg_feature_cols_path is not None:
            reg_cols = list(joblib.load(reg_feature_cols_path))
        reg_cols = _resolve_feature_columns(reg_model, reg_cols)
        if not reg_cols:
            raise ValueError("Unable to resolve regression feature columns for LightGBM model.")

        reg_row = np.array([[_reg_value(c, features) for c in reg_cols]], dtype=float)
        pred = float(reg_model.predict(reg_row)[0])

        anchor = _safe_float(features.get("prev3_avg_savings", 0.0))
        vol = abs(_safe_float(features.get("prev3_std_savings", 0.0)))
        # Guardrail: artifact can drift if feature spaces differ from training context.
        # Fall back to recent observed average savings when prediction is implausibly large.
        sanity_limit = max(20000.0, abs(anchor) * 8.0 + vol * 5.0)
        if abs(pred) > sanity_limit:
            pred = anchor

        base_spread = max(250.0, vol)
        low = pred - base_spread
        high = pred + base_spread

        cls_probability = None
        cls_model_path = _load_first_existing(CLS_MODEL_CANDIDATES)
        if cls_model_path is None:
            raise FileNotFoundError(
                "LightGBM classification artifact missing. Expected: server/ml/models/goal_classification_lightgbm.pkl"
            )

        cls_model = joblib.load(cls_model_path)
        _assert_model_type(cls_model, "LGBMClassifier", cls_model_path)
        cls_cols = _resolve_feature_columns(cls_model, explicit_cols=[])
        if cls_cols:
            cls_row = np.array([[_cls_value(c, features) for c in cls_cols]], dtype=float)
            cls_probability = float(cls_model.predict_proba(cls_row)[0][1])

        out = {
            "predicted_savings": pred,
            "low_savings": low,
            "high_savings": high,
            "residual_std": base_spread,
            "classification_probability": cls_probability,
        }
        sys.stdout.write(json.dumps(out))
    except Exception as exc:
        sys.stderr.write(f"predict_goal_projection error: {exc}\\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
