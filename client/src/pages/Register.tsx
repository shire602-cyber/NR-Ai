import { useEffect } from "react";
import { useLocation } from "wouter";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { fetchCurrentUser } from "@/lib/auth";
import { establishAuthenticatedSession } from "@/lib/authSession";

export default function Register() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    fetchCurrentUser()
      .then((user) => {
        if (user)
          setLocation(
            user.userType === "client_portal" ? "/client-portal/dashboard" : "/dashboard"
          );
      })
      .catch(() => {});
  }, [setLocation]);

  const handleSuccess = async (user: any) => {
    const currentUser = await establishAuthenticatedSession(user);
    setLocation(
      currentUser?.userType === "client_portal" ? "/client-portal/dashboard" : "/dashboard"
    );
  };

  return (
    <AuthLayout
      headline={
        <>
          The ledger,{" "}
          <span className="italic" style={{ color: "#C19E50" }}>
            handled
          </span>
          .
        </>
      }
      subline="Snap a receipt, forward an invoice, or sync a bank line — Muhasib books it, files it, and keeps you FTA-compliant from day one."
    >
      <RegisterForm onSuccess={handleSuccess} />
    </AuthLayout>
  );
}
