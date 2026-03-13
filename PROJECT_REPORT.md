# FinWise / FinTrackAI Project Report

## 1. Executive Summary

FinWise (FinTrackAI) is a personal finance web application that combines transaction management, behavioral insights, goal planning, and an AI-assisted financial reasoning workflow.

The project evolved from a basic dashboard into a more complete personal-finance system with:

- transaction ingestion, editing, deletion, filtering, and PDF-assisted import
- insight generation based on real spending behavior
- goal forecasting using trained machine learning models
- an assistant that combines deterministic analytics with LLM-based plain-language narration
- account management, auditability, and accessibility improvements suitable for a capstone/demo setting

The current implementation is designed to support users with different levels of financial literacy. A major recent focus was making outputs easier to understand while keeping the calculations traceable.

---

## 2. Objectives

The project aimed to deliver:

- reliable transaction ingestion, storage, editing, and filtering
- understandable visual analytics for income, expenses, and savings behavior
- goal tracking with predictions such as "Can I hit this goal by the deadline?"
- assistant support for descriptive, predictive, and prescriptive finance questions
- explainable outputs rather than opaque black-box answers
- an accessible, dark-mode compatible, user-friendly interface

---

## 3. System Architecture

### 3.1 Frontend

- Framework: React + TypeScript
- Routing: `react-router-dom`
- UI: Tailwind + shared UI components
- Data handling: `@tanstack/react-query`

Key pages:

- `Dashboard`
- `Transactions`
- `Goals`
- `Insights`
- `Assistant`
- `My Account`

### 3.2 Backend

- Runtime: Node.js + Express + TypeScript
- Auth: Firebase Auth token verification via Firebase Admin SDK
- Storage: Firestore (`users`, `transactions`, `goals`, `insights`, assistant chats/messages, audit logs)

Key backend services:

- goal projection and savings-allocation logic
- assistant reasoning engine
- monthly insights generation
- transaction import, update, and delete APIs

### 3.3 ML Integration

The goal projection service combines:

- a regression model for projected monthly savings
- a classification model for deadline achievability support
- deterministic timeline calculations for projected completion date

The backend serves a goal projection contract including:

- required monthly savings to hit deadline
- projected completion date
- projected monthly savings
- explainability fields such as recent trend and savings gap

The user-facing goal status is now timeline-first: if the projected completion date is before the deadline, the goal is treated as on track. This avoids contradictory UI states.

---

## 4. Major Features Implemented

## 4.1 Goals Module

- Added deadline-priority savings allocation across goals.
- Added goal status logic:
  - Completed
  - On Track
  - Approaching Deadline
  - Difficult
- Added edit and delete actions on goal cards.
- Added optional per-goal allocation override both on create and edit.
- Restored projected completion date behavior for non-completed goals based on current savings trend.
- Suppressed unnecessary prediction details for completed goals.
- Unified allocation logic into a shared backend function used by goals and assistant.
- Removed user-facing achievability percentage from goal cards because it could conflict with the clearer timeline-first status presentation.

## 4.2 Assistant Module

Assistant was upgraded into a financial reasoning workflow:

- intent and sub-intent routing
- deterministic analytics/model execution
- structured response output
- LLM-based readability improvement
- deterministic guardrails + LLM planner hybrid routing

Supported query classes:

- Descriptive: trend/category/month summaries, category comparisons, unusual-month explanations
- Predictive: savings/income/expense forecasts, goal deadline checks
- Prescriptive: savings-improvement recommendations with simulations

Additional enhancements:

- follow-up context handling with recent chat history
- dynamic suggested follow-up questions
- bottom-only suggestion buttons in UI
- prompt understanding + planner/executor/narrator structure
- privacy-aware LLM input redaction/minimization
- low-confidence generic queries now trigger clarification (instead of unsafe guessing)
- added robust handling for category-specific, category-comparison, unusual-month, and spending-pattern prompts
- simplified assistant response details into one `Explanation` dropdown instead of multiple fragmented technical panels
- improved narration prompt so the first answer is more descriptive and easier to understand for low financial literacy users

## 4.3 Goal-Aware Prescriptive Recommendations

When a goal is selected, prescriptive responses now use goal context:

- reads selected goal
- computes monthly shortfall to deadline
- simulates category reduction scenarios (5/10/20%)
- indicates whether each scenario closes the gap
- provides actionable plan to hit goal

## 4.4 Chat and Account Management

Assistant chat features:

- create/list/load/delete chats
- rename chat
- export chat as JSON

Account features:

- `My Account` entry added above logout
- profile page with editable name/email
- delete account action
- backend account endpoints for get/update/delete

## 4.5 Transactions and Import Workflow

- Added explicit PDF import preview before save.
- Added backend transaction update/delete APIs so edits and deletes persist consistently to Firestore.
- Prevented accidental client-only state edits from diverging from backend data.
- Improved PDF parsing rules for debit/credit statements and synthetic bank-statement formats used in demo data.

## 4.6 Dashboard Trend Upgrades

- Added expense-category dropdown in Spending Trends.
- Enabled `Income vs Selected Category` trend comparison.
- Removed confusing dual-axis setup and switched to one shared USD axis.
- Added explicit note: both lines use same scale.
- Added stable per-category colors in the expense breakdown chart.
- Set semantic line colors:
  - Income (primary)
  - Expenses/category (comparison line)

## 4.7 Goal Projection Model Finalization

- Locked production model policy to:
  - `LightGBMRegressor`
  - `LightGBMClassifier`
- Runtime now enforces model type checks during artifact load.
- Goal projection Python runtime is configurable with `ML_PYTHON_BIN` for environments where LightGBM is installed (e.g., Anaconda).
- Model artifacts are loaded from finalized notebook export locations under `server/ml/models/.../artifacts_goal`.
- The classification artifact was retrained on the production runtime feature schema to reduce notebook/runtime mismatch.

---

## 5. UI/UX, Accessibility, and Theming Improvements

Dark mode and usability issues were audited and fixed:

- replaced hardcoded light-only colors with theme tokens in key pages
- fixed dark-mode select visibility issues
- fixed native calendar icon visibility in dark mode
- fixed date-range calendar popover clipping/overflow in transactions
- improved text contrast for completed-goal status messaging
- assistant answer UX improved:
  - top-level summary bubble remains concise
  - response details are grouped into one `Explanation` dropdown
  - duplicate direct-answer panel removed

Accessibility work completed includes:

- keyboard navigation support for main interactive flows
- visible focus indicators
- improved form labels and error messaging
- chart summaries and non-color-only cues
- screen-reader-friendly landmarks and chat regions
- contrast fixes across light and dark mode
- clearer, simpler assistant language for financial explanations

---

## 6. API and Data Contracts Added

### Account APIs

- `GET /api/account`
- `PATCH /api/account`
- `DELETE /api/account`

### Assistant APIs

- `GET /api/assistant/health`
- `GET /api/assistant/chats`
- `POST /api/assistant/chats`
- `PATCH /api/assistant/chats/:id`
- `DELETE /api/assistant/chats/:id`
- `GET /api/assistant/chats/:id/messages`
- `GET /api/assistant/chats/:id/export`
- `GET /api/assistant/quick-intents`
- `POST /api/assistant/query`

### Transaction APIs

- `PATCH /api/transactions/:id`
- `DELETE /api/transactions/:id`
- `POST /api/transactions/import`

These routes ensure transaction edits, deletes, and reviewed imports persist through the backend instead of depending on direct client-only writes.

---

## 7. Security, Privacy, and Auditability

- Firebase-authenticated API access.
- Audit logs added for critical user actions (transactions, goals, assistant actions, account updates).
- LLM safety measures:
  - redaction of common sensitive patterns (email, account-like numbers, SSN, phone-like strings)
  - minimal-context prompt payloads
  - deterministic fallback when LLM responses fail/time out/schema-validate poorly

---

## 8. Validation and Quality Checks

After each major implementation batch, TypeScript compile checks were run using:

```bash
npm run check
```

Status at report time: compile checks passing.

The goal-model pipeline was also validated through:

- notebook model comparison
- time-aware splits and cross-validation
- strict latest-window holdout checks
- leakage checks and permutation sanity tests

---

## 9. Known Limitations

- Some assistant answers still depend on date-range quality and transaction completeness.
- Provider-specific native input rendering (date/month controls) can vary by browser.
- LLM narration can degrade to deterministic style during timeout/fallback.
- Account email updates can require re-authentication depending on Firebase auth state.
- Goal projection requires Python environment parity (`lightgbm` installed in `ML_PYTHON_BIN` interpreter).
- Some imported PDF formats still require parser-specific rules when statement layouts are highly custom.
- The assistant remains strongest on the implemented financial question types; unsupported comparisons or vague prompts still need clarification logic.

---

## 10. Current System Outcome

At this stage, the project supports an end-to-end personal-finance workflow:

- ingest and manage transactions
- generate dashboards and spending insights
- plan and track multiple goals
- forecast progress toward goals using trained models
- answer user questions with deterministic calculations plus LLM narration

The system is now substantially closer to a cohesive product rather than a collection of disconnected prototype features.

## 11. Next Steps

1. Add explicit per-response marker in assistant UI (`LLM narration` vs `deterministic fallback`).
2. Add stronger policy controls for prescriptive recommendations (discretionary-first mode toggle).
3. Add responsive calendar behavior (2 months desktop, 1 month mobile).
4. Add end-to-end tests for:
   - assistant intent routing
   - goal deadline recommendations
   - account deletion flow
5. Finalize capstone package with architecture diagrams, screenshots, and evaluation appendix.

---

## 12. Conclusion

The project now functions as a robust finance assistant system rather than a static tracker.  
Core workflows (transactions, goals, insights, assistant, account management) are integrated, explainable, and production-oriented.  
The implemented foundation supports both capstone demonstration and future feature scaling.
