# FinWise / FinTrackAI Project Report

## 1. Executive Summary

FinWise (FinTrackAI) is a personal finance platform that combines transaction tracking, goal planning, insights generation, and an AI assistant.  
The system was upgraded from static dashboards to a data-driven and model-assisted product with:

- goal deadline forecasting and achievability estimation
- explainable recommendations on how to close savings gaps
- interactive assistant with context-aware query handling
- production-style backend APIs, audit logs, and account management

This report summarizes the implementation completed to date.

---

## 2. Objectives

The project aimed to deliver:

- reliable transaction ingestion and filtering
- insightful visual analytics for spending behavior
- goal tracking with predictions: "can I hit this goal by deadline?"
- assistant support for descriptive, predictive, and prescriptive questions
- a dark-mode compatible, user-friendly interface

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
- Auth: Firebase Auth token verification
- Storage: Firestore (users, transactions, goals, insights, assistant chats/messages, audit logs)

Key backend services:

- goal projection + allocation logic
- assistant reasoning engine
- monthly insights generation

### 3.3 ML Integration

The goal projection service supports regression/classification style outputs and serves a contract including:

- probability achievable by deadline
- required monthly savings to hit deadline
- predicted completion date
- explainability factors

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
- Added optional per-goal allocation override.
- Suppressed unnecessary prediction details for completed goals.
- Unified allocation logic into a shared backend function used by goals and assistant.

## 4.2 Assistant Module

Assistant was upgraded into a financial reasoning workflow:

- intent and sub-intent routing
- deterministic analytics/model execution
- structured response output
- LLM-based readability improvement

Supported query classes:

- Descriptive: trend/category/month summaries
- Predictive: savings/income/expense forecasts, goal deadline checks
- Prescriptive: savings-improvement recommendations with simulations

Additional enhancements:

- follow-up context handling with recent chat history
- dynamic suggested follow-up questions
- bottom-only suggestion buttons in UI
- prompt understanding + planner/executor/narrator structure
- privacy-aware LLM input redaction/minimization

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

## 4.5 Dashboard Trend Upgrades

- Added expense-category dropdown in Spending Trends.
- Enabled `Income vs Selected Category` trend comparison.
- Removed confusing dual-axis setup and switched to one shared USD axis.
- Added explicit note: both lines use same scale.
- Set semantic line colors:
  - Income (primary)
  - Expenses/category (destructive)

---

## 5. UI/UX and Theming Improvements

Dark mode issues were audited and fixed:

- replaced hardcoded light-only colors with theme tokens in key pages
- fixed dark-mode select visibility issues
- fixed native calendar icon visibility in dark mode
- fixed date-range calendar popover clipping/overflow in transactions
- improved text contrast for completed-goal status messaging

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

---

## 9. Known Limitations

- Some assistant answers still depend on date-range quality and transaction completeness.
- Provider-specific native input rendering (date/month controls) can vary by browser.
- LLM narration can degrade to deterministic style during timeout/fallback.
- Account email updates can require re-authentication depending on Firebase auth state.

---

## 10. Next Steps

1. Add explicit per-response marker in assistant UI (`LLM narration` vs `deterministic fallback`).
2. Add stronger policy controls for prescriptive recommendations (discretionary-first mode toggle).
3. Add responsive calendar behavior (2 months desktop, 1 month mobile).
4. Add end-to-end tests for:
   - assistant intent routing
   - goal deadline recommendations
   - account deletion flow
5. Finalize capstone package with architecture diagrams, screenshots, and evaluation appendix.

---

## 11. Conclusion

The project now functions as a robust finance assistant system rather than a static tracker.  
Core workflows (transactions, goals, insights, assistant, account management) are integrated, explainable, and production-oriented.  
The implemented foundation supports both capstone demonstration and future feature scaling.

