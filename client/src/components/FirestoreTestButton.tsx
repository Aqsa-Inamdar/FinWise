import { useState } from "react";
import { db } from "@/lib/firebase";
import { collection, addDoc } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthProvider";

export default function FirestoreTestButton() {
  const [status, setStatus] = useState<string>("");
  const { user } = useAuth();

  const handleTest = async () => {
    setStatus("Testing...");
    try {
      if (!user) {
        setStatus("Please sign in to test Firestore.");
        return;
      }
      const docRef = await addDoc(collection(db, "users", user.uid, "test-connection"), {
        timestamp: new Date().toISOString(),
        message: "Hello from frontend!",
      });
      setStatus(`Success! Document ID: ${docRef.id}`);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  };

  return (
    <div className="my-4">
      <Button onClick={handleTest}>Test Firestore Connection</Button>
      {status && <div className="mt-2 text-sm">{status}</div>}
    </div>
  );
}
