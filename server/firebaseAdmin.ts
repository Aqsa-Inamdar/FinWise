import { initializeApp, cert, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Use GOOGLE_APPLICATION_CREDENTIALS env var or fallback to applicationDefault
if (!getApps().length) {
  initializeApp({
    credential: process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? cert(process.env.GOOGLE_APPLICATION_CREDENTIALS)
      : applicationDefault(),
  });
}

export const firestore = getFirestore();
