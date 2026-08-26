import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg p-8 text-white">
        <div className="max-w-lg rounded-lg border border-red-500/20 bg-red-500/5 p-6">
          <h1 className="mb-2 text-xl font-semibold">Something went wrong</h1>
          <p className="mb-4 text-sm text-muted">
            An unexpected error occurred. You can try again, or reload the app.
          </p>
          <pre className="mb-4 max-h-40 overflow-auto rounded bg-black/40 p-3 text-xs text-red-400">
            {this.state.error.message}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium hover:bg-accent-hover"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="rounded-md border border-white/10 px-4 py-2 text-sm hover:bg-white/5"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
