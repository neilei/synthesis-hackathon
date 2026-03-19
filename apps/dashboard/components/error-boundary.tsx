"use client";

import { Component, type ReactNode } from "react";
import { EmptyState } from "./ui/empty-state";
import { Button } from "./ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <EmptyState
          dotColor="bg-accent-danger"
          title="Something went wrong"
          description={this.state.error.message || "An unexpected error occurred."}
        >
          <Button
            variant="outline"
            size="md"
            onClick={() => this.setState({ error: null })}
            className="mt-2"
          >
            Try Again
          </Button>
        </EmptyState>
      );
    }

    return this.props.children;
  }
}
