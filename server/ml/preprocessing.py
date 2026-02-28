import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler


# ===============================
# 1. FEATURE LIST
# ===============================

FEATURES = [
    "remaining_amount",
    "months_left",
    "required_monthly",
    "prev3_avg_savings",
    "prev3_std_savings",
    "prev3_trend",
    "prev3_avg_income",
    "prev3_avg_expense",
    "prev3_income_std",
    "prev3_expense_std",
    "lag1_savings",
    "lag2_savings",
    "target_savings_ratio",
    "month_sin",
    "month_cos",
]


# ===============================
# 2. TARGET CREATION
# ===============================

def create_classification_target(df):
    """
    Create binary success label:
    1 = Goal achievable within deadline
    0 = Not achievable
    """
    df = df.copy()

    df["goal_success"] = (
        df["prev3_avg_savings"] * df["months_left"]
        >= df["remaining_amount"]
    ).astype(int)

    return df


def create_regression_target(df):
    """
    Create months_to_completion target
    """
    df = df.copy()

    df["months_to_completion"] = (
        df["remaining_amount"] / df["prev3_avg_savings"]
    )

    # Clip extreme values
    df["months_to_completion"] = df["months_to_completion"].clip(upper=36)

    return df


# ===============================
# 3. FEATURE PREPARATION
# ===============================

def prepare_features(df):
    """
    Select model features
    """
    X = df[FEATURES].copy()
    return X


# ===============================
# 4. TRAIN TEST SPLIT
# ===============================

def split_data(X, y, test_size=0.2, random_state=42):
    """
    Standard train-test split
    """
    return train_test_split(
        X, y,
        test_size=test_size,
        random_state=random_state,
        stratify=y if len(y.unique()) == 2 else None
    )


# ===============================
# 5. SCALING (OPTIONAL)
# ===============================

def scale_features(X_train, X_test):
    """
    Scale features for linear models.
    Not required for tree-based models.
    """
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    return X_train_scaled, X_test_scaled, scaler
