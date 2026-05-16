import importlib.util
import io
import json
from pathlib import Path

import numpy as np
import pytest


MODULE_PATH = Path(__file__).resolve().parents[1] / "predict_goal_projection.py"
SPEC = importlib.util.spec_from_file_location("predict_goal_projection", MODULE_PATH)
predict_goal_projection = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(predict_goal_projection)


def test_reg_value_alias_mapping_and_defaults():
    features = {
        "lag1_savings": 120.0,
        "lag2_savings": 90.0,
        "prev3_avg_savings": 100.0,
        "prev3_std_savings": 10.0,
        "month_num": 5,
    }

    assert predict_goal_projection._reg_value("lag_1", features) == 120.0
    assert predict_goal_projection._reg_value("lag_2", features) == 90.0
    assert predict_goal_projection._reg_value("roll3_mean", features) == 100.0
    assert predict_goal_projection._reg_value("roll3_std", features) == 10.0
    assert predict_goal_projection._reg_value("quarter", features) == 2.0
    assert predict_goal_projection._reg_value("credit_score", features) == 0.0


def test_cls_value_alias_mapping_and_defaults():
    features = {
        "prev3_avg_expense": 450.0,
        "prev3_expense_std": 25.0,
        "prev3_avg_savings": 300.0,
        "prev3_std_savings": 15.0,
        "remaining_amount": 5000.0,
        "month_num": 7,
    }

    assert predict_goal_projection._cls_value("lag_spend_1", features) == 450.0
    assert predict_goal_projection._cls_value("roll_spend_std_6", features) == 25.0
    assert predict_goal_projection._cls_value("roll_net_mean_3", features) == 300.0
    assert predict_goal_projection._cls_value("required_amount_h", features) == 5000.0
    assert predict_goal_projection._cls_value("year_num", features) == 0.0
    assert predict_goal_projection._cls_value("month_num", features) == 7.0


def test_resolve_feature_columns_prefers_explicit_then_model_metadata():
    explicit = ["a", "b"]
    model_with_feature_names_in = type("ModelA", (), {"feature_names_in_": np.array(["x", "y"])})()
    model_with_lightgbm_names = type("ModelB", (), {"feature_name_": ["m", "n"]})()
    bare_model = type("ModelC", (), {})()

    assert predict_goal_projection._resolve_feature_columns(model_with_feature_names_in, explicit) == explicit
    assert predict_goal_projection._resolve_feature_columns(model_with_feature_names_in, []) == ["x", "y"]
    assert predict_goal_projection._resolve_feature_columns(model_with_lightgbm_names, []) == ["m", "n"]
    assert predict_goal_projection._resolve_feature_columns(bare_model, []) == []


def test_assert_model_type_rejects_wrong_artifact_type():
    with pytest.raises(ValueError, match="Expected LGBMRegressor"):
        predict_goal_projection._assert_model_type(object(), "LGBMRegressor", "fake.joblib")


def test_main_applies_guardrail_and_emits_prediction(monkeypatch, tmp_path):
    reg_path = tmp_path / "reg.joblib"
    reg_cols_path = tmp_path / "reg_cols.joblib"
    cls_path = tmp_path / "cls.pkl"
    reg_path.write_text("x")
    reg_cols_path.write_text("x")
    cls_path.write_text("x")

    class LGBMRegressor:
        feature_names_in_ = np.array(["lag_1"])

        def predict(self, rows):
            assert rows.shape == (1, 1)
            return np.array([999999.0])

    class LGBMClassifier:
        feature_names_in_ = np.array(["remaining_amount"])

        def predict_proba(self, rows):
            assert rows.shape == (1, 1)
            return np.array([[0.15, 0.85]])

    def fake_load(path):
        path = Path(path)
        if path == reg_path:
            return LGBMRegressor()
        if path == reg_cols_path:
            return ["lag_1"]
        if path == cls_path:
            return LGBMClassifier()
        raise AssertionError(f"Unexpected path {path}")

    monkeypatch.setattr(predict_goal_projection, "REG_MODEL_CANDIDATES", [reg_path])
    monkeypatch.setattr(predict_goal_projection, "REG_FEATURES_CANDIDATES", [reg_cols_path])
    monkeypatch.setattr(predict_goal_projection, "CLS_MODEL_CANDIDATES", [cls_path])
    monkeypatch.setattr(predict_goal_projection.joblib, "load", fake_load)
    monkeypatch.setattr(
        predict_goal_projection.sys,
        "stdin",
        io.StringIO(json.dumps({"features": {"lag1_savings": 200, "prev3_avg_savings": 400, "remaining_amount": 1200}})),
    )
    stdout = io.StringIO()
    monkeypatch.setattr(predict_goal_projection.sys, "stdout", stdout)

    predict_goal_projection.main()

    payload = json.loads(stdout.getvalue())
    assert payload["predicted_savings"] == 400.0
    assert payload["low_savings"] == 150.0
    assert payload["high_savings"] == 650.0
    assert payload["classification_probability"] == 0.85


def test_main_exits_when_artifacts_are_missing(monkeypatch):
    monkeypatch.setattr(predict_goal_projection, "_load_first_existing", lambda _: None)
    monkeypatch.setattr(predict_goal_projection.sys, "stdin", io.StringIO("{}"))
    monkeypatch.setattr(predict_goal_projection.sys, "stderr", io.StringIO())

    with pytest.raises(SystemExit) as excinfo:
      predict_goal_projection.main()

    assert excinfo.value.code == 1
