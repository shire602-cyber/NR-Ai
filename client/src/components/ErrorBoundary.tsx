
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Detect stale chunk load errors that happen after a new deployment.
 * The browser has cached the old index.html with old JS chunk hashes,
 * but the server now has different hashes.
 */
function isChunkLoadError(error: Error): boolean {
  const msg = error.message || '';
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Loading chunk') ||
    msg.includes('Loading CSS chunk') ||
    msg.includes('Importing a module script failed')
  );
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

    // Auto-refresh on stale chunk errors (max once per session to avoid loops)
    if (isChunkLoadError(error)) {
      const lastRefresh = sessionStorage.getItem('chunk_error_refresh');
      const now = Date.now();
      // Only auto-refresh if we haven't refreshed in the last 10 seconds
      if (!lastRefresh || now - Number(lastRefresh) > 10_000) {
        sessionStorage.setItem('chunk_error_refresh', String(now));
        window.location.reload();
        return;
      }
    }
  }

  render() {
    if (this.state.hasError) {
      const isStaleChunk = this.state.error && isChunkLoadError(this.state.error);

      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <Card className="max-w-lg">
            <CardHeader>
              <div className="flex items-center gap-2">
                {isStaleChunk ? (
                  <RefreshCw className="w-5 h-5 text-primary" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-destructive" />
                )}
                <CardTitle>
                  {isStaleChunk ? 'App Updated' : 'Something went wrong'}
                </CardTitle>
              </div>
              <CardDescription>
                {isStaleChunk
                  ? 'A new version of the app has been deployed. Please refresh to load the latest version.'
                  : 'The application encountered an error. Please try refreshing the page.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isStaleChunk && this.state.error && (
                <pre className="p-4 bg-muted rounded-md text-xs overflow-auto">
                  {this.state.error.toString()}
                </pre>
              )}
              <Button
                onClick={() => window.location.reload()}
                className="w-full"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh Page
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
