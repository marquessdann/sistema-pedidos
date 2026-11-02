import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Check, ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react';
import { bpsToInput, centsToInput, parseBRLToCents, parsePercentToBps } from '@della/shared';
import type { Tone } from '../../lib/labels';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- Botões
type Variant = 'primary' | 'gold' | 'secondary' | 'ghost' | 'danger' | 'success';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-navy-900 text-white hover:bg-navy-700 shadow-sm',
  gold: 'bg-gold-500 text-white hover:bg-gold-600 shadow-sm',
  secondary: 'bg-white text-navy-900 border border-line hover:bg-navy-50 shadow-xs',
  ghost: 'text-navy-800 hover:bg-navy-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-6 text-base',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({ to, variant = 'secondary', size = 'md', icon, children, className }: { to: string; variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <Link
      to={to}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-sm' : size === 'lg' ? 'h-12 px-6 text-base' : 'h-10 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- Campos
const inputBase =
  'w-full h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-slate-400 transition focus:border-navy-400 focus:ring-2 focus:ring-navy-100 outline-none disabled:bg-slate-50 disabled:text-slate-500';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(inputBase, invalid && 'border-red-400 focus:ring-red-100', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(inputBase, 'h-auto min-h-20 py-2', invalid && 'border-red-400', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx(inputBase, 'pr-8', invalid && 'border-red-400', className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({ label, error, hint, required, children, className }: { label?: ReactNode; error?: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cx('block', className)}>
      <label className="block">
        {label && (
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
            {label}
            {required && (
              <span className="ml-0.5 text-red-500" aria-hidden>
                *
              </span>
            )}
          </span>
        )}
        {children}
      </label>
      {error ? (
        <span className="mt-1 block text-xs text-red-600" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      ) : null}
    </div>
  );
}

/** Campo com máscara (CNPJ, CPF, telefone, CEP). Guarda o valor formatado. */
export function MaskedInput({ value, onChange, mask, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void; mask: (v: string) => string; invalid?: boolean }) {
  return <Input value={value} onChange={(e) => onChange(mask(e.target.value))} inputMode={rest.inputMode ?? 'numeric'} {...rest} />;
}

/** Campo monetário em R$. Valor externo em centavos. */
export function MoneyInput({ value, onChange, invalid, ...rest }: { value: number | null; onChange: (cents: number | null) => void; invalid?: boolean; placeholder?: string; disabled?: boolean; id?: string; 'aria-label'?: string }) {
  const [text, setText] = useState(centsToInput(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(centsToInput(value));
  }, [value]);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted">R$</span>
      <Input
        {...rest}
        invalid={invalid}
        inputMode="decimal"
        className="pl-9 text-right tabular"
        value={text}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,]/g, '');
          setText(t);
          onChange(t === '' ? null : parseBRLToCents(t));
        }}
        onBlur={() => {
          focused.current = false;
          setText(centsToInput(value));
        }}
      />
    </div>
  );
}

/** Campo de percentual. Valor externo em bps. */
export function PercentInput({ value, onChange, invalid, max = 100, ...rest }: { value: number | null; onChange: (bps: number | null) => void; invalid?: boolean; max?: number; placeholder?: string; disabled?: boolean; id?: string; className?: string; 'aria-label'?: string }) {
  const [text, setText] = useState(bpsToInput(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(bpsToInput(value));
  }, [value]);
  return (
    <div className="relative">
      <Input
        {...rest}
        invalid={invalid}
        inputMode="decimal"
        className={cx('pr-8 text-right tabular', rest.className)}
        value={text}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,]/g, '');
          setText(t);
          const bps = t === '' ? null : parsePercentToBps(t);
          onChange(bps === null ? null : Math.min(bps, max * 100));
        }}
        onBlur={() => {
          focused.current = false;
          setText(bpsToInput(value));
        }}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">%</span>
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('flex items-start gap-3', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-navy-800' : 'bg-slate-300')}
      >
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'left-4.5' : 'left-0.5')} />
      </button>
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- Layout
export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cx('rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(15,35,65,0.04)]', padded && 'p-5', className)}>{children}</div>;
}

export function CardTitle({ children, actions, icon, className }: { children: ReactNode; actions?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-4 flex items-center justify-between gap-3', className)}>
      <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-navy-900">
        {icon && <span className="text-gold-500">{icon}</span>}
        {children}
      </h3>
      {actions}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-navy-800">
            <ArrowLeft className="size-4" /> Voltar
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const TONES: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  navy: 'bg-navy-50 text-navy-800 ring-navy-200',
  gold: 'bg-gold-50 text-gold-700 ring-gold-200',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
};
export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone], className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-5 animate-spin text-navy-400', className)} />;
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-navy-50 text-navy-400">{icon ?? <Inbox className="size-6" />}</div>
      <p className="font-medium text-navy-900">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Não foi possível carregar os dados.';
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-red-50 text-red-500">
        <AlertTriangle className="size-6" />
      </div>
      <p className="font-medium text-navy-900">Algo deu errado</p>
      <p className="mt-1 max-w-md text-sm text-muted">{msg}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = 'amber', title, children, icon }: { tone?: 'amber' | 'red' | 'blue' | 'green' | 'navy'; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const t = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    blue: 'border-sky-200 bg-sky-50 text-sky-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    navy: 'border-navy-200 bg-navy-50 text-navy-900',
  }[tone];
  return (
    <div className={cx('flex gap-3 rounded-lg border px-4 py-3 text-sm', t)} role={tone === 'red' ? 'alert' : undefined}>
      <span className="mt-0.5 shrink-0">{icon ?? <AlertTriangle className="size-4" />}</span>
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title ? 'mt-0.5' : '', 'opacity-90')}>{children}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Modal
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-navy-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cx(
          'animate-fadein relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-3xl',
          size === 'xl' && 'sm:max-w-5xl',
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-navy-900">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-slate-100" aria-label="Fechar">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmOpts {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger' | 'gold' | 'success';
}
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              {state?.cancelLabel ?? 'Cancelar'}
            </Button>
            <Button variant={state?.tone ?? 'primary'} onClick={() => close(true)} autoFocus>
              {state?.confirmLabel ?? 'Confirmar'}
            </Button>
          </>
        }
      >
        <div className="text-sm text-ink">{state?.message}</div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ---------------------------------------------------------------- Tabela
export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  hideOnMobile?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  onRowClick,
  loading,
  empty,
  footer,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (r: T) => string;
  sort?: string;
  onSort?: (s: string) => void;
  onRowClick?: (r: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  footer?: ReactNode;
}) {
  const sortIcon = (k?: string) => {
    if (!k || !onSort) return null;
    if (sort === `${k}_asc`) return <ArrowUp className="size-3.5" />;
    if (sort === `${k}_desc`) return <ArrowDown className="size-3.5" />;
    return <ArrowUpDown className="size-3.5 opacity-40" />;
  };
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-slate-50/70">
            {columns.map((c) => (
              <th
                key={c.key}
                className={cx(
                  'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted',
                  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left',
                  c.hideOnMobile && 'hidden md:table-cell',
                  c.className,
                )}
              >
                {c.sortKey && onSort ? (
                  <button
                    className={cx('inline-flex items-center gap-1 hover:text-navy-900', c.align === 'right' && 'flex-row-reverse')}
                    onClick={() => onSort(sort === `${c.sortKey}_desc` ? `${c.sortKey}_asc` : `${c.sortKey}_desc`)}
                  >
                    {c.header}
                    {sortIcon(c.sortKey)}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows?.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cx('border-b border-line/70 last:border-0', onRowClick && 'cursor-pointer hover:bg-navy-50/50')}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cx(
                    'px-4 py-3 align-middle',
                    c.align === 'right' ? 'text-right tabular' : c.align === 'center' ? 'text-center' : '',
                    c.hideOnMobile && 'hidden md:table-cell',
                    c.className,
                  )}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
      {loading && !rows?.length && <Loading />}
      {loading && !!rows?.length && (
        <div className="absolute inset-0 flex items-start justify-center bg-white/50 pt-10">
          <Spinner />
        </div>
      )}
      {!loading && rows && rows.length === 0 && (empty ?? <EmptyState title="Nenhum registro encontrado" description="Ajuste os filtros ou a pesquisa." />)}
    </div>
  );
}

export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
      <span>
        {total} registro{total === 1 ? '' : 's'}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="tabular">
          {page} de {pages}
        </span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            '-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
            value === t.value ? 'border-gold-500 text-navy-900' : 'border-transparent text-muted hover:text-navy-800',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone = 'navy', to }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'navy' | 'gold' | 'green' | 'amber' | 'red'; to?: string }) {
  const iconTone = { navy: 'bg-navy-50 text-navy-700', gold: 'bg-gold-50 text-gold-600', green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-600' }[tone];
  const content = (
    <Card className={cx('h-full', to && 'transition hover:border-navy-200 hover:shadow-md')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
          <p className="mt-2 truncate text-2xl font-semibold tabular text-navy-900">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
        </div>
        {icon && <div className={cx('flex size-10 shrink-0 items-center justify-center rounded-lg', iconTone)}>{icon}</div>}
      </div>
    </Card>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

export function Stepper({ steps, current, onStep }: { steps: string[]; current: number; onStep?: (i: number) => void }) {
  return (
    <ol className="flex w-full items-center gap-1 overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              disabled={!onStep || i > current}
              onClick={() => onStep?.(i)}
              className="flex min-w-0 items-center gap-2 disabled:cursor-default"
              aria-current={active ? 'step' : undefined}
            >
              <span
                className={cx(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  done && 'bg-gold-500 text-white',
                  active && 'bg-navy-900 text-white ring-4 ring-navy-100',
                  !done && !active && 'bg-slate-200 text-slate-500',
                )}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </span>
              <span className={cx('hidden truncate text-sm lg:block', active ? 'font-semibold text-navy-900' : 'text-muted')}>{s}</span>
            </button>
            {i < steps.length - 1 && <span className={cx('h-0.5 min-w-4 flex-1 rounded', done ? 'bg-gold-400' : 'bg-slate-200')} />}
          </li>
        );
      })}
    </ol>
  );
}

export function KeyValue({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-3', cols === 2 && 'sm:grid-cols-2', cols === 3 && 'sm:grid-cols-3')}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{k}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{v || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
