import fs from "fs";
import path from "path";
import { initializeApp, cert, getApps, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const LOCAL_SERVICE_ACCOUNT = path.resolve(
  process.cwd(),
  "finwise-2026-firebase-adminsdk-fbsvc-a8b6b7962f.json",
);

const loadServiceAccount = () => {
  const explicitPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const candidatePath = explicitPath || (fs.existsSync(LOCAL_SERVICE_ACCOUNT) ? LOCAL_SERVICE_ACCOUNT : null);

  if (!candidatePath) return null;
  if (!fs.existsSync(candidatePath)) return null;

  try {
    const raw = fs.readFileSync(candidatePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

if (!getApps().length) {
  const serviceAccount = loadServiceAccount();
  initializeApp({
    credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
    ...(serviceAccount?.project_id ? { projectId: serviceAccount.project_id } : {}),
  });
}

export const firestore = getFirestore();
firestore.settings({ ignoreUndefinedProperties: true });
