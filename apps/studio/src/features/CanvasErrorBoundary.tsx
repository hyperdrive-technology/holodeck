import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/** Keeps a canvas crash inside the canvas pane: the document list, library and inspector stay usable. */
export class CanvasErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('canvas crashed', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey: string }) {
    // Opening another document gets a fresh canvas.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-medium">The canvas stopped with an error.</p>
        <pre className="max-w-xl overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{this.state.error.message}</pre>
        <Button variant="outline" size="sm" onClick={() => this.setState({ error: null })}>
          Reload canvas
        </Button>
      </div>
    );
  }
}
