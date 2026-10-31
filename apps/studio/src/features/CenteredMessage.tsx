/** A full-area status (loading, missing document) or error message. */
export function CenteredMessage({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="flex h-full flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
