import { Component, ErrorInfo, ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

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
      <div className="app-ambient flex h-screen w-screen items-center justify-center p-8 text-white">
        <div className="panel max-w-lg p-7">
          <span className="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-red-500/[0.12] text-red-300 ring-1 ring-inset ring-red-400/20">
            <TriangleAlert size={26} />
          </span>
          <h1 className="mb-2 text-xl font-bold tracking-tight">Something went wrong</h1>
          <p className="mb-4 text-sm leading-relaxed text-ink-2">
            An unexpected error occurred. You can try again, or reload the app.
          </p>
          <pre className="thin-scrollbar mb-5 max-h-40 overflow-auto rounded-xl border border-white/[0.06] bg-black/40 p-3 text-xs text-red-300">
            {this.state.error.message}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="btn btn-primary"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="btn btn-secondary"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
