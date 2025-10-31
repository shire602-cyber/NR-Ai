import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { setToken, setStoredUser, isAuthenticated } from '@/lib/auth';

export default function Register() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isAuthenticated()) {
      setLocation('/');
    }
  }, [setLocation]);

  const handleSuccess = (token: string, user: any) => {
    setToken(token);
    setStoredUser(user);
    setLocation('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <RegisterForm onSuccess={handleSuccess} />
    </div>
  );
}
