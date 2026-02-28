"""Firestore service utilities for insight generation."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import firebase_admin
from firebase_admin import credentials, firestore


def _initialize_app() -> None:
    if not firebase_admin._apps:
        firebase_admin.initialize_app()


def get_client() -> firestore.Client:
    """Return an initialized Firestore client."""
    _initialize_app()
    return firestore.client()


def month_range(month_key: str) -> Tuple[datetime, datetime]:
    """Return inclusive start and exclusive end datetime for the month."""
    year, month = month_key.split("-")
    year_int = int(year)
    month_int = int(month)
    start = datetime(year_int, month_int, 1, tzinfo=timezone.utc)
    if month_int == 12:
        end = datetime(year_int + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year_int, month_int + 1, 1, tzinfo=timezone.utc)
    return start, end


def fetch_transactions(user_id: str, month_key: str) -> List[Dict]:
    """Fetch transactions for a user within the given month."""
    client = get_client()
    start, end = month_range(month_key)
    return [
        doc.to_dict()
        for doc in client.collection("users")
        .document(user_id)
        .collection("transactions")
        .where("date", ">=", start.isoformat())
        .where("date", "<", end.isoformat())
        .stream()
    ]


def fetch_historical_cvs(user_id: str, limit: int = 6) -> List[float]:
    """Fetch historical coefficient-of-variation values from stored insights."""
    client = get_client()
    docs = (
        client.collection("users")
        .document(user_id)
        .collection("insights")
        .order_by("month", direction=firestore.Query.DESCENDING)
        .limit(limit)
        .stream()
    )
    cvs: List[float] = []
    for doc in docs:
        data = doc.to_dict() or {}
        stats = data.get("variabilityStats", {})
        cv = stats.get("cv")
        if isinstance(cv, (int, float)):
            cvs.append(float(cv))
    return cvs


def store_variability_insight(
    user_id: str,
    month_key: str,
    insight: Dict,
    stats: Dict,
    method: str,
) -> None:
    """Persist the variability insight into the monthly insights document."""
    client = get_client()
    doc_ref = client.collection("users").document(user_id).collection("insights").document(month_key)
    doc_ref.set(
        {
            "month": month_key,
            "variabilityInsight": insight,
            "variabilityStats": stats,
            "variabilityMethod": method,
            "generatedAt": datetime.now(tz=timezone.utc).isoformat(),
        },
        merge=True,
    )
