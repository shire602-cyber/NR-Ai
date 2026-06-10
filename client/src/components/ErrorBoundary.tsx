import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import { apiUrl } from '@/lib/api';

interface Props {
  children: ReactNode;
  /** Identifier reported to the server (e.g. "invoices", "reports"). */
  name?: string;
  /** Custom fallback. Receives the error and a retry callback. */
  fallback?: (error: Error, retry: () => void) => ReactNode;
  /** Variant of the default fallback. "section" is inline; "page" is full-screen. */
  variant?: 'page' | 'section';
}

interface State {
  hasError: boolean;
  error: Error | null;
}

async function reportToServer(error: Error, info: ErrorInfo, name?: string) {
  try {
    await fetch(apiUrl('/api/client-errors'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        boundary: name,
      }),
    });
  } catch {
    // Logging is best-effort; never let it cascade.
  }
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    void reportToServer(error, errorInfo, this.props.name);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const error = this.state.error;

    if (this.props.fallback && error) {
      return this.props.fallback(error, this.handleRetry);
    }

    if (this.props.variant === 'section') {
      return (
        <SectionErrorFallback
          error={error}
          onRetry={this.handleRetry}
          name={this.props.name}
        />
      );
    }

    return <PageErrorFallback error={error} onRetry={this.handleRetry} />;
  }
}

function PageErrorFallback({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-full bg-destructive/10">
              <AlertCircle className="w-6 h-6 text-destructive" />
            </div>
            <CardTitle className="text-xl">Something went wrong</CardTitle>
          </div>
          <CardDescription>
            An unexpected error occurred. You can try again or return to the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && import.meta.env.DEV && (
            <pre className="p-3 bg-muted rounded-md text-xs overflow-auto max-h-32 text-muted-foreground">
              {error.toString()}
            </pre>
          )}
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => (window.location.href = '/dashboard')} className="flex-1">
              <Home className="w-4 h-4 mr-2" />
              Dashboard
            </Button>
            <Button onClick={onRetry} className="flex-1">
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionErrorFallback({
  error,
  onRetry,
  name,
}: {
  error: Error | null;
  onRetry: () => void;
  name?: string;
}) {
  return (
    <div
      role="alert"
      data-testid={name ? `error-boundary-${name}` : 'error-boundary-section'}
      className="rounded-lg border border-destructive/30 bg-destructive/5 p-6"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-full bg-destructive/10 shrink-0">
          <AlertCircle className="w-5 h-5 text-destructive" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium mb-1">
            {name ? `${name} couldn't load` : 'This section couldn\'t load'}
          </h3>
          <p className="text-sm text-muted-foreground mb-3">
            We've been notified. You can retry, or continue using the rest of the app.
          </p>
          {error && import.meta.env.DEV && (
            <pre className="p-2 bg-muted rounded text-xs overflow-auto max-h-32 text-muted-foreground mb-3">
              {error.message}
            </pre>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Retry
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => (window.location.href = '/dashboard')}
            >
              <Home className="w-3.5 h-3.5 mr-1.5" />
              Dashboard
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SectionBoundaryProps {
  name: string;
  children: ReactNode;
}

/** Convenience wrapper: in-page error boundary with the section variant. */
export function SectionBoundary({ name, children }: SectionBoundaryProps) {
  return (
    <ErrorBoundary name={name} variant="section">
      {children}
    </ErrorBoundary>
  );
}
