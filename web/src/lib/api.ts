let csrfToken = '';
export function setCsrf(token: string | null | undefined) {
  csrfToken = token ?? '';
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

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; query?: Query; form?: FormData } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}${qs(opts.query)}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua internet e tente novamente.', 'NETWORK');
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
