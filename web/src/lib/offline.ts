/**
 * Modo sem internet do vendedor.
 *
 * - "Sincronizar" baixa um pacote (catálogo, preços, fotos, clientes, condições) e guarda no aparelho (IndexedDB).
 * - Sem sinal, as telas do vendedor leem esse pacote; pedidos/orçamentos/clientes novos ficam numa fila
 *   ("aguardando envio") no próprio aparelho.
 * - Com sinal, a fila é enviada ao servidor, que confere tudo de novo (preços, limites, estoque).
 *   Cada envio usa a mesma chave de idempotência: reenviar nunca duplica pedido.
 */
import { useEffect, useState } from 'react';
import { calculate, checkDiscountLimit, normalizeCnpj, todayInTz, type CalcResult, type PricingRule } from '@della/shared';
import { api, ApiError, newKey } from './api';

// ------------------------------------------------------------------ tipos
export interface SnapshotProduct {
  id: string;
  sku: string;
  name: string;
  unit: string;
  unitsPerBox: number | null;
  description: string | null;
  priceCents: number;
  imageFileName: string | null;
  images: string[];
  availableQty: number | null;
  brand: { id: string; name: string };
  category: { id: string; name: string } | null;
}

export interface Snapshot {
  generatedAt: string;
  savedAt: string;
  config: {
    today: string;
    timezone: string;
    maxDiscountBps: number;
    stockEnabled: boolean;
    surchargeRules: PricingRule[];
    paymentTerms: { id: string; name: string; days: string | null }[];
    [k: string]: unknown;
  };
  brands: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  products: SnapshotProduct[];
  clients: any[];
}

export type OutboxKind = 'order' | 'quote' | 'client';

export interface OutboxEntry {
  /** = chave de idempotência do documento (ou id provisório do cliente) */
  id: string;
  kind: OutboxKind;
  method: 'POST' | 'PUT';
  path: string;
  body: any;
  label: string;
  totalCents?: number;
  action?: string;
  createdAt: string;
  status: 'pending' | 'error' | 'review';
  error?: string;
  /** valor mudou com os preços atuais: o vendedor precisa confirmar */
  priceDiff?: { before: number; after: number };
  acceptedTotalCents?: number;
  /** estado da tela de montagem, para abrir e corrigir */
  wizard?: { mode: 'order' | 'quote'; state: any };
}

export interface SentEntry {
  kind: OutboxKind;
  id: string;
  number?: string;
  label: string;
  totalCents?: number;
  at: string;
}

// ------------------------------------------------------------------ armazenamento (IndexedDB, com reserva em memória)
const memory = new Map<string, unknown>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open('della-offline', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return memory.get(key) as T | undefined;
  return new Promise((resolve) => {
    try {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => resolve(memory.get(key) as T | undefined);
    } catch {
      resolve(memory.get(key) as T | undefined);
    }
  });
}

async function kvSet(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    try {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Falha ao gravar no aparelho.'));
      tx.onabort = () => reject(tx.error ?? new Error('Sem espaço no aparelho para guardar os dados.'));
    } catch (e) {
      reject(e as Error);
    }
  });
}

// ------------------------------------------------------------------ estado
let userId: string | null = null;
let snapshot: Snapshot | null = null;
let snapshotLoaded: Promise<Snapshot | null> | null = null;
let syncing = false;
let downloading = false;
const FORCE_KEY = 'della:offline-forced';

const k = (name: string) => `${name}:${userId}`;

function emit() {
  window.dispatchEvent(new Event('della:offline-change'));
}

/** Chamado pelo login: os dados offline são separados por usuário. */
export function setOfflineUser(id: string | null) {
  if (id === userId) return;
  userId = id;
  snapshot = null;
  snapshotLoaded = null;
  if (id) void loadSnapshot().then(emit);
}

export function isForcedOffline() {
  try {
    return localStorage.getItem(FORCE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setForcedOffline(v: boolean) {
  try {
    if (v) localStorage.setItem(FORCE_KEY, '1');
    else localStorage.removeItem(FORCE_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

/** Trabalhando sem internet: aparelho sem conexão ou modo "sem internet" ligado pelo vendedor (sinal fraco). */
export function workingOffline() {
  return !!userId && (isForcedOffline() || (typeof navigator !== 'undefined' && navigator.onLine === false));
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  if (!userId) return null;
  if (snapshot) return snapshot;
  snapshotLoaded ??= kvGet<Snapshot>(k('snapshot')).then((s) => (snapshot = s ?? null));
  return snapshotLoaded;
}

export function snapshotInfo() {
  return snapshot ? { savedAt: snapshot.savedAt, products: snapshot.products.length, clients: snapshot.clients.length } : null;
}

// ------------------------------------------------------------------ leitura das telas sem internet
const OFFLINE_GET = [/^\/seller\/config$/, /^\/seller\/brands$/, /^\/seller\/categories$/, /^\/seller\/catalog$/, /^\/seller\/clients$/, /^\/seller\/clients\/[^/]+$/];

/** Rotas que funcionam sem internet (respondidas com os dados baixados). */
export function offlineCapable(method: string, path: string) {
  if (!userId) return false;
  if (method === 'GET') return OFFLINE_GET.some((r) => r.test(path));
  return method === 'POST' && path === '/seller/pricing/preview';
}

export function hasSnapshot() {
  return !!snapshot;
}

const fold = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export async function resolveOffline(method: string, path: string, query: Record<string, unknown> = {}, body?: any): Promise<unknown> {
  const snap = await loadSnapshot();
  if (!snap) return undefined;
  const cfg = snap.config;
  if (path === '/seller/config') return { ...cfg, today: todayInTz(cfg.timezone) };
  if (path === '/seller/brands') return snap.brands;
  if (path === '/seller/categories') return snap.categories;
  if (path === '/seller/catalog') {
    const q = fold(query.q);
    const list = snap.products.filter(
      (p) =>
        (!query.brandId || p.brand.id === query.brandId) &&
        (!query.categoryId || p.category?.id === query.categoryId) &&
        (!q || fold(p.name).includes(q) || fold(p.sku).includes(q) || fold(p.brand.name).includes(q)) &&
        !(query.onlyAvailable === 'true' && p.availableQty !== null && p.availableQty <= 0),
    );
    const brands = new Map<string, { id: string; name: string; products: SnapshotProduct[] }>();
    for (const p of list) {
      const b = brands.get(p.brand.id) ?? { id: p.brand.id, name: p.brand.name, products: [] };
      b.products.push(p);
      brands.set(p.brand.id, b);
    }
    return { stockEnabled: cfg.stockEnabled, brands: [...brands.values()], total: list.length, offline: true };
  }
  if (path === '/seller/clients') {
    const q = fold(query.q);
    const digits = normalizeCnpj(String(query.q ?? ''));
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const list = snap.clients
      .filter(
        (c) =>
          (query.onlyActive !== 'true' || c.status === 'ACTIVE') &&
          (!q || fold(c.legalName).includes(q) || fold(c.tradeName).includes(q) || fold(c.responsibleName).includes(q) || (digits.length >= 3 && String(c.cnpj).includes(digits))),
      )
      .sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE') || String(a.legalName).localeCompare(String(b.legalName), 'pt-BR'));
    const items = list.slice((page - 1) * pageSize, page * pageSize);
    return { items, total: list.length, page, pageSize, pages: Math.max(1, Math.ceil(list.length / pageSize)), offline: true };
  }
  const m = /^\/seller\/clients\/([^/]+)$/.exec(path);
  if (m) {
    const c = snap.clients.find((x) => x.id === m[1]);
    if (!c) throw new ApiError(404, 'Cliente não encontrado nos dados baixados. Sincronize quando tiver internet.', 'NOT_FOUND');
    return { ...c, stats: { orders: c.stats?.orders ?? 0, lastOrderDate: c.stats?.lastOrderDate ?? null }, recentOrders: [], recentQuotes: [], offline: true };
  }
  if (method === 'POST' && path === '/seller/pricing/preview') return localPreview(snap, body);
  return undefined;
}

/** Mesmo cálculo do servidor, com os preços baixados (o servidor confere de novo ao sincronizar). */
function localPreview(snap: Snapshot, body: any) {
  const items: { productId: string; quantity: number; discountBps?: number; saleUnit?: 'UN' | 'CX' }[] = body?.items ?? [];
  const products = new Map(snap.products.map((p) => [p.id, p]));
  const calc = calculate({
    items: items.map((i) => {
      const p = products.get(i.productId);
      if (!p) throw new ApiError(422, 'Produto fora dos dados baixados (pode ter sido desativado). Remova-o ou sincronize.', 'PRODUCT_NOT_FOUND');
      const factor = i.saleUnit === 'CX' && p.unitsPerBox ? p.unitsPerBox : 1;
      return { productId: p.id, quantity: i.quantity, discountBps: i.discountBps ?? 0, unitPriceCents: p.priceCents * factor, brandId: p.brand.id, categoryId: p.category?.id ?? null };
    }),
    generalDiscountBps: body?.generalDiscountBps ?? 0,
    freightCents: body?.freightCents ?? 0,
    rules: snap.config.surchargeRules ?? [],
  });
  const check = checkDiscountLimit(calc, snap.config.maxDiscountBps);
  const { internal: _i, lines, ...rest } = calc;
  return {
    calc: { ...rest, lines: lines.map(({ costCents: _c, internalTaxCents: _t, ...l }) => l) } as unknown as CalcResult,
    check,
    offline: true,
    pricesFrom: snap.savedAt,
  };
}

// ------------------------------------------------------------------ fila "aguardando envio"
export async function listOutbox(): Promise<OutboxEntry[]> {
  if (!userId) return [];
  return (await kvGet<OutboxEntry[]>(k('outbox'))) ?? [];
}

async function saveOutbox(list: OutboxEntry[]) {
  await kvSet(k('outbox'), list);
  emit();
}

export async function putOutbox(entry: OutboxEntry) {
  const list = await listOutbox();
  const i = list.findIndex((e) => e.id === entry.id);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  await saveOutbox(list);
}

export async function removeOutbox(id: string) {
  const list = await listOutbox();
  if (!list.some((e) => e.id === id)) return;
  await saveOutbox(list.filter((e) => e.id !== id));
}

export async function patchOutbox(id: string, patch: Partial<OutboxEntry>) {
  const list = await listOutbox();
  await saveOutbox(list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
}

export async function listSent(): Promise<SentEntry[]> {
  if (!userId) return [];
  return (await kvGet<SentEntry[]>(k('sent'))) ?? [];
}

async function addSent(s: SentEntry) {
  const list = [s, ...(await listSent())].slice(0, 30);
  await kvSet(k('sent'), list);
}

/** Pedido/orçamento montado sem internet: fica guardado no aparelho até sincronizar. */
export async function queueDoc(e: Omit<OutboxEntry, 'createdAt' | 'status'>) {
  await putOutbox({ ...e, createdAt: new Date().toISOString(), status: 'pending' });
}

/** Cliente cadastrado sem internet: recebe um id provisório e já aparece na lista (só para orçamento). */
export async function queueClient(body: any): Promise<{ id: string; offline: true }> {
  const snap = await loadSnapshot();
  const cnpj = normalizeCnpj(String(body.cnpj ?? ''));
  if (snap?.clients.some((c) => c.cnpj === cnpj)) {
    throw new ApiError(409, 'Este CNPJ já está na sua lista de clientes.', 'DUPLICATE_CNPJ');
  }
  const id = newKey();
  await putOutbox({ id, kind: 'client', method: 'POST', path: '/seller/clients', body, label: body.tradeName || body.legalName, createdAt: new Date().toISOString(), status: 'pending' });
  if (snap) {
    snap.clients.push({
      id,
      legalName: body.legalName,
      tradeName: body.tradeName || null,
      cnpj,
      stateRegistration: body.stateRegistration || null,
      responsibleName: body.responsibleName || null,
      commercialPhone: body.commercialPhone || null,
      commercialEmail: body.commercialEmail || null,
      address: { cep: body.cep || null, state: body.state || null, city: body.city || null, district: body.district || null, street: body.street || null, number: body.number || null, complement: body.complement || null },
      city: body.city || null,
      state: body.state || null,
      notes: body.notes || null,
      status: 'UNDER_REVIEW',
      selectable: true,
      canOrder: false,
      pendingApproval: true,
      reviewNote: null,
      editable: false,
      offlinePending: true,
      raw: {},
    });
    await kvSet(k('snapshot'), snap);
  }
  emit();
  return { id, offline: true };
}

// ------------------------------------------------------------------ sincronização
/** Baixa o pacote de dados (e as fotos dos produtos) para usar sem internet. */
export async function downloadSnapshot(opts: { images?: boolean } = {}) {
  if (!userId || downloading) return;
  downloading = true;
  emit();
  try {
    const data = await api<Omit<Snapshot, 'savedAt'>>('/seller/offline-snapshot');
    // clientes cadastrados sem internet que ainda não foram enviados continuam na lista
    const queued = (await listOutbox()).filter((e) => e.kind === 'client').map((e) => e.id);
    const keep = (snapshot?.clients ?? []).filter((c) => queued.includes(c.id));
    const next: Snapshot = { ...data, clients: [...data.clients, ...keep], savedAt: new Date().toISOString() };
    await kvSet(k('snapshot'), next);
    snapshot = next;
    snapshotLoaded = Promise.resolve(next);
    emit();
    if (opts.images !== false) void cacheImages(next);
  } finally {
    downloading = false;
    emit();
  }
}

const IMAGE_CACHE = 'della-product-images';

async function cacheImages(snap: Snapshot) {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(IMAGE_CACHE);
    const urls = [...new Set(snap.products.map((p) => p.imageFileName).filter(Boolean))].map((f) => `/api/files/products/${f}`);
    const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
    const missing = urls.filter((u) => !have.has(u));
    let i = 0;
    const worker = async () => {
      while (i < missing.length) {
        const u = missing[i++];
        try {
          const res = await fetch(u, { credentials: 'same-origin' });
          if (res.ok) await cache.put(u, res);
        } catch {
          return; // caiu a conexão: termina na próxima sincronização
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    // remove fotos de produtos que saíram do catálogo
    const wanted = new Set(urls);
    for (const req of await cache.keys()) if (!wanted.has(new URL(req.url).pathname)) await cache.delete(req);
  } catch {
    /* sem espaço ou navegador sem suporte: as fotos aparecem quando houver internet */
  }
}

export interface SyncResult {
  sent: number;
  review: number;
  errors: number;
  offline: boolean;
}

const isNetwork = (e: unknown) => e instanceof ApiError && e.status === 0;
const isAuth = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403);

/**
 * Envia a fila ao servidor e baixa os dados atualizados.
 * Ordem: clientes novos (recebem o id definitivo) → pedidos/orçamentos → pacote de dados.
 */
export async function syncNow(): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, review: 0, errors: 0, offline: false };
  if (!userId || syncing) return result;
  syncing = true;
  emit();
  try {
    const idMap = new Map<string, string>();
    let list = await listOutbox();

    for (const e of list.filter((x) => x.kind === 'client' && x.status !== 'error')) {
      try {
        const res = await api<{ id: string }>(e.path, { method: e.method, body: e.body });
        idMap.set(e.id, res.id);
        await removeOutbox(e.id);
        await addSent({ kind: 'client', id: res.id, label: e.label, at: new Date().toISOString() });
        result.sent += 1;
      } catch (err) {
        if (isNetwork(err) || isAuth(err)) throw err;
        await patchOutbox(e.id, { status: 'error', error: (err as Error).message });
        result.errors += 1;
      }
    }

    // troca o id provisório do cliente pelo definitivo nos documentos
    list = await listOutbox();
    if (idMap.size) {
      list = list.map((e) => {
        const real = e.body?.clientId && idMap.get(e.body.clientId);
        if (!real) return e;
        return { ...e, body: { ...e.body, clientId: real }, wizard: e.wizard ? { ...e.wizard, state: { ...e.wizard.state, clientId: real } } : e.wizard };
      });
      await saveOutbox(list);
    }
    const pendingClients = new Set(list.filter((e) => e.kind === 'client').map((e) => e.id));

    for (const e of list.filter((x) => x.kind !== 'client' && x.status === 'pending')) {
      if (pendingClients.has(e.body?.clientId)) {
        await patchOutbox(e.id, { status: 'error', error: 'O cadastro do cliente ainda não foi aceito pelo servidor. Resolva o cliente primeiro.' });
        result.errors += 1;
        continue;
      }
      try {
        // confere o valor com os preços atuais antes de enviar
        const pv = await api<{ calc: CalcResult }>('/seller/pricing/preview', {
          body: { items: e.body.items, generalDiscountBps: e.body.generalDiscountBps, freightCents: e.body.freightCents },
        });
        const now = pv.calc.totalCents;
        const accepted = e.acceptedTotalCents ?? e.totalCents;
        if (accepted !== undefined && now !== accepted) {
          await patchOutbox(e.id, { status: 'review', priceDiff: { before: e.totalCents ?? 0, after: now } });
          result.review += 1;
          continue;
        }
        const res = await api<any>(e.path, { method: e.method, body: e.body });
        const doc = res.order ?? res.quote;
        await removeOutbox(e.id);
        await addSent({ kind: e.kind, id: doc.id, number: doc.number ?? undefined, label: e.label, totalCents: doc.totalCents, at: new Date().toISOString() });
        result.sent += 1;
      } catch (err) {
        if (isNetwork(err) || isAuth(err)) throw err;
        await patchOutbox(e.id, { status: 'error', error: (err as Error).message });
        result.errors += 1;
      }
    }

    await downloadSnapshot();
  } catch (err) {
    if (isNetwork(err)) result.offline = true;
    else throw err;
  } finally {
    syncing = false;
    emit();
  }
  return result;
}

/** Vendedor aceita o valor recalculado (preço mudou desde o download) e libera o envio. */
export async function acceptNewPrice(id: string) {
  const e = (await listOutbox()).find((x) => x.id === id);
  if (!e?.priceDiff) return;
  await patchOutbox(id, { status: 'pending', acceptedTotalCents: e.priceDiff.after, priceDiff: undefined, error: undefined });
}

export async function retryEntry(id: string) {
  await patchOutbox(id, { status: 'pending', error: undefined });
}

/** Remove um item da fila; cliente provisório sai também da lista local. */
export async function discardEntry(id: string) {
  const e = (await listOutbox()).find((x) => x.id === id);
  await removeOutbox(id);
  if (e?.kind === 'client' && snapshot) {
    snapshot.clients = snapshot.clients.filter((c) => c.id !== id);
    await kvSet(k('snapshot'), snapshot);
    emit();
  }
}

// ------------------------------------------------------------------ hook para as telas
export function useOffline() {
  const read = () => ({
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    forced: isForcedOffline(),
    syncing,
    downloading,
    snapshot: snapshotInfo(),
  });
  const [state, setState] = useState(read);
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [sent, setSent] = useState<SentEntry[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      setState(read());
      void listOutbox().then((l) => alive && setOutbox(l));
      void listSent().then((l) => alive && setSent(l));
    };
    refresh();
    void loadSnapshot().then(refresh);
    window.addEventListener('della:offline-change', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    return () => {
      alive = false;
      window.removeEventListener('della:offline-change', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, []);
  return { ...state, offline: state.forced || !state.online, outbox, sent, pending: outbox.length };
}
