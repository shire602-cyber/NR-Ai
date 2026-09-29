import { useEffect } from "react";
import { useLocation } from "wouter";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { fetchCurrentUser } from "@/lib/auth";
import { establishAuthenticatedSession } from "@/lib/authSession";
import { messages as pageMessages } from "./Register.i18n";

export default function Register() {
  const tr = pageMessages.useT();

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
          {tr("theLedger")}
          <span className="italic" style={{ color: "#C19E50" }}>
            {tr("handled")}
          </span>
          .
        </>
      }
      subline={tr("snapAReceiptForwardAnInvoice")}
    >
      <RegisterForm onSuccess={handleSuccess} />
    </AuthLayout>
  );
}
