import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in React ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-[#0a0a0a] text-red-500 font-mono p-4">
          <h2 className="text-2xl font-bold mb-4">CRITICAL UI ERROR</h2>
          <p className="mb-4">Mixi encountered a fatal rendering error.</p>
          <pre className="bg-black/50 p-4 rounded border border-red-900/50 text-xs overflow-auto max-w-2xl">
            {this.state.error?.message}
          </pre>
          <button
            className="mt-6 px-4 py-2 bg-red-900/20 hover:bg-red-900/40 border border-red-500/50 rounded transition-colors"
            onClick={() => window.location.reload()}
          >
            RELOAD INTERFACE
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
