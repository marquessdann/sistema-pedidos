import { loadSnapshot, offlineCapable, resolveOffline, workingOffline } from './offline';

let csrfToken = '';
export function setCsrf(token: string | null | undefined) {
  csrfToken = token ?? '';
}

/** Gestor usa as mesmas telas do administrador; as chamadas /admin/* vão para /manager/* (restritas no servidor). */
let scope: 'admin' | 'manager' = 'admin';
export function setApiScope(s: 'admin' | 'manager') {
  scope = s;
}
export function scopedPath(path: string) {
  return scope === 'manager' && path.startsWith('/admin/') ? `/manager/${path.slice(7)}` : path;
}
/** URL para links diretos (ex.: download de CSV). */
export function apiHref(path: string, query?: Query) {
  return `/api${scopedPath(path)}${qs(query)}`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: any,
    public issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined | string[]>;

export function qs(query?: Query) {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) p.set(k, v.join(','));
    } else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; query?: Query; form?: FormData; timeoutMs?: number } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  // modo sem internet (vendedor): telas de catálogo/clientes/cálculo usam os dados baixados no aparelho
  const canOffline = offlineCapable(method, path) && !!(await loadSnapshot());
  if (canOffline && workingOffline()) {
    const local = await resolveOffline(method, path, opts.query, opts.body);
    if (local !== undefined) return local as T;
  }
  // sinal fraco costuma "travar" a conexão: com dados no aparelho, não espera indefinidamente
  const timeoutMs = opts.timeoutMs ?? (canOffline ? 8000 : path.startsWith('/seller/') && method !== 'GET' ? 25000 : 0);
  const ctrl = timeoutMs && typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res: Response;
  try {
    res = await fetch(`/api${scopedPath(path)}${qs(opts.query)}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: ctrl?.signal,
    });
  } catch {
    if (canOffline) {
      const local = await resolveOffline(method, path, opts.query, opts.body);
      if (local !== undefined) return local as T;
    }
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua internet e tente novamente.', 'NETWORK');
  } finally {
    if (timer) clearTimeout(timer);
  }
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) window.dispatchEvent(new Event('della:unauthorized'));
    if (data?.error === 'PASSWORD_CHANGE_REQUIRED') window.dispatchEvent(new Event('della:password-change'));
    throw new ApiError(res.status, data?.message ?? `Erro ${res.status}`, data?.error, data?.details, data?.issues);
  }
  return data as T;
}

export function errorMessage(e: unknown) {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Ocorreu um erro inesperado.';
}

/** Mapeia erros de validação do servidor para os campos do formulário. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !e.issues) return {};
  const out: Record<string, string> = {};
  for (const i of e.issues) if (!out[i.path]) out[i.path] = i.message;
  return out;
}

export function newKey() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export const fileUrl = {
  product: (f?: string | null) => (f ? `/api/files/products/${f}` : null),
  doc: (id: string, download = false) => `/api/documents/file/${id}${download ? '?download=1' : ''}`,
  logo: '/api/files/company/logo',
};
