"use client";

import { Component, type ReactNode } from "react";

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

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center gap-4 p-8 sm:p-16 text-center">
          <div aria-hidden="true" className="rounded-full bg-bg-surface p-4">
            <div className="h-3 w-3 rounded-full bg-accent-danger" />
          </div>
          <h2 className="text-lg font-medium text-text-primary">
            Something went wrong
          </h2>
          <p className="max-w-md text-sm text-text-secondary">
            {this.state.error.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-2 cursor-pointer rounded-lg border border-accent-positive px-5 py-2.5 min-h-[44px] text-sm font-medium text-accent-positive transition-colors hover:bg-accent-positive-dim active:bg-accent-positive/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent-positive"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
