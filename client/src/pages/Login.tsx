import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { LoginForm } from '@/components/auth/LoginForm';
import { setToken, setStoredUser, isAuthenticated } from '@/lib/auth';

export default function Login() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isAuthenticated()) {
      setLocation('/dashboard');
    }
  }, [setLocation]);

  const handleSuccess = (token: string, user: any) => {
    setToken(token);
    setStoredUser(user);
    setLocation('/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <LoginForm onSuccess={handleSuccess} />
    </div>
  );
}
