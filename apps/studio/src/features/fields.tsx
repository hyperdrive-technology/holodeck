import { useEffect, useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Coerced } from './inspector.logic';

/**
 * Fields whose text differs from their committed value (typed and not yet
 * committed, or refused by validation). The playground asks before throwing
 * its workspace away (holodeck#249): such text exists nowhere else.
 */
const uncommittedDrafts = new Set<string>();
export function hasUncommittedDraft(): boolean {
  return uncommittedDrafts.size > 0;
}

/**
 * A text-like field with a draft: typing edits the draft only; Enter or blur
 * commits it through `coerce`, Escape reverts. An invalid draft is flagged and
 * not committed. The draft resets whenever the committed value changes from
 * outside (undo on the canvas, another selection).
 */
export function DraftField({
  label,
  value,
  coerce,
  onCommit,
  type = 'text',
  suffix,
  inputProps,
}: {
  label: string;
  value: string;
  coerce: (input: string) => Coerced;
  onCommit: (value: unknown) => void;
  type?: 'text' | 'number';
  suffix?: string;
  inputProps?: React.ComponentProps<'input'>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setDraft(value);
    setProblem(null);
  }, [value]);
  useEffect(() => {
    if (draft === value) return;
    uncommittedDrafts.add(id);
    return () => void uncommittedDrafts.delete(id);
  }, [draft, value, id]);

  const commit = () => {
    if (draft === value) return;
    const result = coerce(draft);
    if (!result.ok) {
      setProblem(result.reason);
      return;
    }
    setProblem(null);
    onCommit(result.value);
  };

  return (
    <div className="grid grid-cols-[6rem_1fr] items-center gap-2">
      <Label htmlFor={id} className="truncate" title={label}>
        {label}
      </Label>
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          type={type}
          value={draft}
          aria-invalid={problem ? true : undefined}
          title={problem ?? undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(value);
              setProblem(null);
            }
          }}
          {...inputProps}
        />
        {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
      {problem ? <p className="col-start-2 text-xs text-destructive">{problem}</p> : null}
    </div>
  );
}

export function ReadonlyField({ label, value, testId }: { label: string; value: React.ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-[6rem_1fr] items-center gap-2 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="truncate" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}
