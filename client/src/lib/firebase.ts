import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { getFirestore, doc, setDoc, serverTimestamp } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Google provider helper
export const googleAuthProvider = new GoogleAuthProvider();

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleAuthProvider);
}

export async function signUpWithEmailPassword(params: {
  email: string;
  password: string;
  name: string;
}) {
  const { email, password, name } = params;
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  if (auth.currentUser) {
    await updateProfile(auth.currentUser, { displayName: name });
  }
  await setDoc(
    doc(db, "users", credential.user.uid),
    {
      id: credential.user.uid,
      name,
      email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      provider: "password",
    },
    { merge: true }
  );
  return credential;
}

export async function signInWithEmailPassword(params: { email: string; password: string }) {
  const { email, password } = params;
  return signInWithEmailAndPassword(auth, email, password);
}

export default app;
