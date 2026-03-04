import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthProvider";
import { auth } from "@/lib/firebase";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type AccountPayload = {
  id: string;
  name: string;
  email: string;
};

export default function Account() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signOut } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiRequest("GET", "/api/account");
        const data = (await res.json()) as AccountPayload;
        setName(data.name ?? "");
        setEmail(data.email ?? "");
      } catch (error: any) {
        toast({
          title: "Account",
          description: error?.message ?? "Unable to load account.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [toast]);

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast({ title: "Account", description: "Name and email are required.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      await apiRequest("PATCH", "/api/account", {
        name: name.trim(),
        email: email.trim(),
      });

      if (auth.currentUser) {
        await auth.currentUser.reload();
      }

      toast({ title: "Account updated", description: "Your account details were saved." });
    } catch (error: any) {
      toast({
        title: "Account",
        description: error?.message ?? "Unable to update account.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const onDeleteAccount = async () => {
    const confirmed = window.confirm(
      "Delete your account permanently? This will remove your profile, goals, chats, and transactions.",
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await apiRequest("DELETE", "/api/account");
      await signOut();
      navigate("/login", { replace: true });
    } catch (error: any) {
      toast({
        title: "Delete account",
        description: error?.message ?? "Unable to delete account.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div>
        <h1 className="text-3xl font-light tracking-tight">My Account</h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile and account settings.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading account...</p>
          ) : (
            <form className="space-y-4" onSubmit={onSave}>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Name</p>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Email</p>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delete Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Permanently delete your account and all associated data.
          </p>
          <Button variant="destructive" onClick={onDeleteAccount} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete Account"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
