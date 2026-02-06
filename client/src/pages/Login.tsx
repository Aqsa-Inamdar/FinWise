import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Wallet } from "lucide-react";
import { signInWithEmailPassword, signInWithGoogle, signUpWithEmailPassword } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthProvider";

export default function Login() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (user) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signInWithEmailPassword({ email, password });
      navigate("/dashboard");
    } catch (e) {
      console.error("Email sign-in failed", e);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signUpWithEmailPassword({ email, password, name });
      navigate("/dashboard");
    } catch (e) {
      console.error("Account creation failed", e);
    }
  };

  const handleGoogle = async () => {
    try {
      await signInWithGoogle();
      navigate("/dashboard");
    } catch (e) {
      console.error("Google sign-in failed", e);
    }
  };

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background p-4"
      aria-labelledby="login-page-title"
      role="main"
    >
      <h1 id="login-page-title" className="sr-only">
        Sign in to FinWise
      </h1>
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Wallet className="h-8 w-8 text-primary" />
          </div>
          <div>
            <CardTitle className="text-2xl font-light tracking-tight" data-testid="text-login-title">
              {isCreatingAccount ? "Create your FinWise account" : "Welcome to FinWise"}
            </CardTitle>
            <CardDescription className="mt-2">
              {isCreatingAccount
                ? "Create an account to start tracking your finances"
                : "Sign in to manage your personal finances"}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={isCreatingAccount ? handleCreateAccount : handleLogin}
            className="space-y-4"
          >
            {isCreatingAccount && (
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="input-name"
                  aria-label="Full name"
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-email"
                aria-label="Email address"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="input-password"
                aria-label="Password"
                required
              />
            </div>
            <Button type="submit" className="w-full" data-testid="button-login">
              {isCreatingAccount ? "Create Account" : "Sign In"}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleGoogle}
              data-testid="button-google"
            >
              Continue with Google
            </Button>
          </div>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {isCreatingAccount ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => setIsCreatingAccount((prev) => !prev)}
              data-testid="link-signup"
            >
              {isCreatingAccount ? "Sign in" : "Sign up"}
            </button>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
