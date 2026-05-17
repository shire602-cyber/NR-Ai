import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/lib/i18n';
import { apiUrl } from '@/lib/api';
import { LogIn } from 'lucide-react';
import { OAuthButtons } from './OAuthButtons';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface LoginFormProps {
  onSuccess: (user: any) => void | Promise<void>;
}

function currentEpochMs(): number {
  if (typeof performance !== 'undefined' && Number.isFinite(performance.timeOrigin)) {
    return Math.round(performance.timeOrigin + performance.now());
  }
  return new Date().getTime();
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  useEffect(() => {
    if (!cooldownUntil) return;

    const update = () => {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - currentEpochMs()) / 1000));
      setCooldownSeconds(remaining);
      if (remaining === 0) setCooldownUntil(null);
    };

    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [cooldownUntil]);

  const isCoolingDown = cooldownSeconds > 0;

  const onSubmit = async (data: LoginFormData) => {
    if (isCoolingDown) return;

    setIsLoading(true);
    try {
      const response = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        if (response.status === 429) {
          const retryAfter = Number(error?.details?.retryAfterSeconds ?? response.headers.get('Retry-After') ?? 60);
          const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 60;
          setCooldownUntil(currentEpochMs() + seconds * 1000);
          setCooldownSeconds(seconds);
        }
        throw new Error(error?.message || 'Login failed');
      }

      const result = await response.json();
      await onSuccess(result.user);
      
      toast({
        title: 'Welcome back!',
        description: 'You have successfully logged in.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Login failed',
        description: error?.message || 'Please check your credentials and try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-semibold">{t.login}</CardTitle>
        <CardDescription>
          Enter your credentials to access your account
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.email}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder="you@example.com"
                      disabled={isLoading || isCoolingDown}
                      data-testid="input-email"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>{t.password}</FormLabel>
                    <Link
                      href="/forgot-password"
                      className="text-xs text-primary hover:underline"
                      data-testid="link-forgot-password"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      placeholder="••••••••"
                      disabled={isLoading || isCoolingDown}
                      data-testid="input-password"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || isCoolingDown}
              data-testid="button-login"
            >
              <LogIn className="w-4 h-4 mr-2" />
              {isLoading ? t.loading : isCoolingDown ? `Try again in ${cooldownSeconds}s` : t.signIn}
            </Button>
            {isCoolingDown && (
              <p className="text-center text-sm text-muted-foreground" role="status">
                Too many failed attempts for this email. Try again in {cooldownSeconds} seconds.
              </p>
            )}
          </form>
        </Form>
        <div className="mt-4">
          <OAuthButtons />
        </div>
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <div className="text-sm text-muted-foreground text-center">
          {t.dontHaveAccount}{' '}
          <Link href="/register" className="text-primary hover:underline font-medium" data-testid="link-register">
            {t.signUp}
          </Link>
        </div>
      </CardFooter>
    </Card>
  );
}
