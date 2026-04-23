
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
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
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
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
              {this.state.error && process.env.NODE_ENV === 'development' && (
                <pre className="p-3 bg-muted rounded-md text-xs overflow-auto max-h-32 text-muted-foreground">
                  {this.state.error.toString()}
                </pre>
              )}
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => window.location.href = '/dashboard'} className="flex-1">
                  <Home className="w-4 h-4 mr-2" />
                  Dashboard
                </Button>
                <Button onClick={this.handleRetry} className="flex-1">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Try Again
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
