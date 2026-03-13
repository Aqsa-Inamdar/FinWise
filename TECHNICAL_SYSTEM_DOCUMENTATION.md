# FinWise Technical System Documentation

## 1. Purpose of This Document

This document explains:

- dataset sources and structure
- ML models used and why
- how the Assistant uses LLM + deterministic models
- insights page calculation logic and formulas
- key implementation details across the web app

It is intended as a technical reference for reviewers, collaborators, and final project submission.

---

## 2. Data Sources

## 2.1 Runtime Application Data (Primary)

The live app runs on Firestore user data:

- `users/{userId}`
- `users/{userId}/transactions`
- `users/{userId}/goals`
- `users/{userId}/insights`
- `users/{userId}/assistant_chats/{chatId}/messages`
- `users/{userId}/audit_logs`

Main transactional schema used by analytics:

- `date` (ISO string)
- `type` (`income` | `expense`)
- `amount` (numeric)
- `category` (string)
- `description` (string)

All core dashboard, goals, insights, and assistant computations use these runtime transactions.

## 2.2 Offline Training / Analysis Datasets

Project folder includes historical datasets used in EDA/model development:

- `transactions_data.csv`
- `users_data.csv`
- `cards_data.csv`
- `mcc_codes.json`
- `train_fraud_labels.json` (present but fraud detection is not active in current web runtime)

The goal modeling notebooks and artifacts in `server/ml/models/archive (5)` were used to train/evaluate model candidates.

The original source dataset used for modeling work came from Kaggle:

- `https://www.kaggle.com/datasets/computingvictor/transactions-fraud-datasets/data`

For model development, the workflow used up to roughly:

- 4,000,000 transaction rows
- 5,000 user records

After cleaning, aggregation, snapshot building, and target construction, the final supervised goal-model training table contained tens of thousands of labeled rows rather than raw transaction rows.

---

## 3. Goal Prediction Models

## 3.1 Runtime Artifacts Used by Backend

`server/ml/predict_goal_projection.py` loads:

- Regression model:
  - `server/ml/models/goal_regression_lightgbm.joblib` (preferred)
  - or `server/ml/models/archive (5)/artifacts_goal/goal_regression_lightgbm.joblib`
  - **Model type**: `LGBMRegressor` (enforced by runtime type checks)
- Regression feature columns:
  - `server/ml/models/goal_regression_feature_cols.joblib` (preferred)
  - or `server/ml/models/archive (5)/artifacts_goal/goal_feature_cols.joblib`
- Classification model:
  - `server/ml/models/goal_classification_lightgbm.pkl` (preferred)
  - or `server/ml/models/archive (5)/artifacts_goal/goal_classification_lightgbm.pkl`
  - **Model type**: `LGBMClassifier` (enforced by runtime type checks)

`server/services/goalProjection.ts` declares final production config as:

- `LightGBMRegressor`
- `LightGBMClassifier`
- threshold policy: `balanced`
- threshold: `0.41`

Note on runtime environment:

- Model loading requires a Python environment with `lightgbm` installed.
- Backend uses `ML_PYTHON_BIN` (from `.env`) to select the interpreter.
- Example: `ML_PYTHON_BIN=/opt/anaconda3/bin/python`

## 3.2 Why These Algorithms

### LightGBM Regressor (monthly savings forecast)

Used for `predicted_savings` because:

- strong non-linear fit on engineered financial time-window features
- robust performance in notebook model comparison/CV
- good bias/variance tradeoff for this tabular feature set

### LightGBM Classifier (deadline achievability support)

Used for deadline-achievability support because:

- strong precision/recall/F1/AUC performance in offline evaluation
- calibrated probability output via `predict_proba`
- efficient inference for per-goal API calls

Important runtime note:

- the original classifier trained in notebook space did not align well enough with production runtime features
- a runtime-aligned `LightGBMClassifier` was retrained on the actual production feature schema used by `predict_goal_projection.py`
- this reduced the notebook/runtime contract mismatch

## 3.3 Feature Engineering (Goal Projection)

Core features built from recent 3-month history include:

- `prev3_avg_savings`
- `prev3_std_savings`
- `prev3_trend`
- `prev3_avg_income`
- `prev3_avg_expense`
- ratios (`prev3_income_ratio`, `prev3_expense_ratio`)
- lag features (`lag1_savings`, `lag2_savings`)
- seasonality (`month_num`, `month_sin`, `month_cos`)

Goal/deadline-specific features injected at prediction time:

- `remaining_amount`
- `months_left`
- `required_monthly`
- `target_savings_ratio`

## 3.4 Goal Decision Contract

For each goal, backend returns:

- predicted monthly savings (point + interval)
- projected completion date
- deadline-achievability support output
- thresholded decision (`achievableByDeadline`)
- explainability points (required monthly gap, trend, volatility, income/expense mix)

Threshold policy in current contract:

- balanced threshold = `0.41`

Current decision hierarchy:

1. Timeline-first status:
   - if projected completion date is before the deadline, the goal is treated as on track
2. Regression forecast:
   - primary source of projected monthly savings
3. Trend fallback:
   - if the regression monthly forecast is non-positive, recent average savings trend can be used to derive a completion timeline
4. Classifier support:
   - classifier remains available in the backend contract and assistant workflow, but user-facing goal-card status is not driven primarily by the raw classification percentage

---

## 4. Assistant Architecture (LLM + Models)

The Assistant is not a free-form chatbot.  
It uses a planner/executor/narrator architecture:

## 4.1 Step A: Planner (LLM)

- Model: `gpt-5-mini`
- Task: analyze user prompt + short chat context and output strict JSON plan:
  - intent (`descriptive` / `predictive` / `prescriptive`)
  - sub-intent
  - metric (income/expense/savings)
  - horizon
  - scenario (% increase/decrease)
  - whether selected goal should be used
  - clarification-needed flag

If ambiguous, assistant returns clarification question instead of low-quality output.
Deterministic lexical guardrails are applied before planner output is accepted for high-signal prompts.

## 4.2 Step B: Deterministic Executor

Backend executes plan using deterministic code and models:

- descriptive stats from transactions
- predictive projections (including goal projection model)
- prescriptive simulations (category-reduction scenarios)

New routing safeguards:

- high-signal descriptive prompts (e.g., "highest spending month", "how much spend on X", "compare X vs Y", "unusual month")
  are protected from being rewritten into predictive forecasts
- low-confidence generic intents trigger clarification instead of potentially wrong answers
- category comparison is handled by a dedicated descriptive route instead of being forced through single-category logic

This ensures numeric correctness and auditability.

## 4.3 Step C: Narrator (LLM)

Computed JSON output is passed to `gpt-5-mini` for plain-language narration.
If narration fails (timeout/schema failure), deterministic response is returned.

UI rendering policy for assistant responses:

- summary bubble at top for quick read
- one `Explanation` dropdown below the answer bubble
- duplicate direct-answer block removed to reduce repetition
- explanation content is grouped to match the actual prompt type rather than showing generic repeated technical panels

Narration prompt policy:

- write in simple financial language
- explain the result in easy terms
- prioritize what happened, why it matters, and what the user should understand next
- avoid overly statistical or technical phrasing when a plain-language version is possible

## 4.4 Context Awareness

Assistant reads recent chat messages to resolve follow-ups (e.g., baseline/same horizon/scenario continuation).

## 4.5 Privacy Controls in LLM Calls

Before any LLM request, prompt/context is redacted/minimized:

- emails redacted
- account/card-like numbers redacted
- SSN-like patterns redacted
- phone-like strings redacted
- message length constrained

Raw transaction rows are not sent to LLM; LLM receives summarized context and computed outputs.

---

## 5. Insights Page Logic and Formulas

Insights are built from monthly transaction aggregation in `server/insights.ts` and behavioral signals in `server/behavioralEngine.ts`.

## 5.1 Core Formulas

### Savings Rate

Savings rate:

`savingsRate = (income - expenses) / income`, if `income > 0`; otherwise `null`.

### Percent Change

Percent change:

`deltaPct = (current - baseline) / baseline`

### Coefficient of Variation (daily spend variability)

Coefficient of variation:

`CV = stdDev / mean`

where:
- `mean` = mean daily spend
- `stdDev` = standard deviation of daily spend

### Category Entropy (spend concentration)

Category entropy:

`H = -sum(p_i * log2(p_i))` for all categories `i`

where `p_i` is category share of total expense.

### Structural Shift Score (distribution change)

Structural shift:

`shift = 0.5 * sum(abs(p_i_current - p_i_previous))` for all categories `i`

### Weekend vs Weekday Differential

Weekend vs weekday differential:

`differentialPct = abs(weekdayAvg - weekendAvg) / max(weekdayAvg, weekendAvg)`

Meaningful if thresholds are satisfied in code (magnitude + minimum observed days).

## 5.2 Insight Types Produced

- `executive_summary`
- `risk`
- `positive`
- `neutral`
- `data_quality`

Insights are prioritized by severity/type ranking and capped for display.

---

## 6. Dashboard Trend Comparison Logic

Spending Trends supports:

- date range selection (month/year bounds)
- toggles for showing income and expenses
- expense category dropdown

For selected category:

- series shown = `Income` vs `Selected Category Expense`
- single shared Y-axis (USD) for direct comparison
- semantic colors:
  - income: primary line color
  - expenses/category: comparison line color

Expense breakdown chart also uses stable category-specific colors so the same category does not change color unpredictably between renders.

Missing months in selected range are zero-filled for continuity.

---

## 7. Goals UI Logic

- Current savings pool computed from all user transactions:
  - `sum(income) - sum(expense)`
- Pool allocated to goals by nearest deadline first.
- Optional per-goal allocation override supported.
- Goal cards show:
  - allocated amount
  - savings left after each goal
  - remaining amount
  - deadline status
  - projected completion date
  - explainability lines such as required monthly savings and recent savings trend

Completed goals suppress unnecessary predictive detail.

User-facing achievability probability was removed from the goal card UI because it could materially conflict with the timeline-first status message. The backend can still retain supporting model outputs for assistant/debug purposes.

---

## 8. Transactions and Data Management

Transaction persistence now uses backend APIs for consistency:

- `PATCH /api/transactions/:id`
- `DELETE /api/transactions/:id`
- `POST /api/transactions/import`

Why this matters:

- edits and deletes are persisted through the backend and audit layer
- client-side state stays aligned with Firestore
- PDF import now follows preview first, explicit save second

PDF parsing notes:

- debit/credit handling was improved so positive debit-like expenses are not incorrectly treated as income
- known statement layouts and category aliases were expanded
- category inference now supports values such as `Rent/Housing` and `EMI/Loan`

---

## 9. Account and Data Management

Implemented account endpoints:

- `GET /api/account`
- `PATCH /api/account`
- `DELETE /api/account`

Delete account flow removes:

- user profile
- goals
- insights
- transactions
- assistant chats/messages
- audit logs
- Firebase Auth user

---

## 10. Accessibility and UX Engineering

Implemented accessibility-oriented improvements include:

- keyboard-accessible interactive controls
- visible focus states
- screen-reader-friendly landmarks and chat region labeling
- accessible form labels and error messaging
- chart summaries so visuals have text alternatives
- non-color-only status signaling
- dark-mode contrast fixes
- simpler assistant narration for users with lower financial literacy

---

## 11. Logging, Audit, and Traceability

Audit logs are written for critical actions:

- income/expense create/delete
- goal create/update/delete
- assistant chat and query lifecycle
- account updates

Assistant queries also store intent/sub-intent/confidence metadata for QA and iteration.

---

## 12. Summary

The web app uses a practical hybrid architecture:

- deterministic finance computations + ML goal models for correctness
- LLM for prompt planning and user-facing narration
- privacy-aware payload minimization/redaction

This design keeps outputs explainable, actionable, and production-friendly while preserving flexibility for richer assistant behavior.
