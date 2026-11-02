import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { STOCK_MOVEMENT_LABELS, STOCK_POLICY_LABELS, formatDateTimeBR } from '@della/shared';
import { api, errorMessage } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import { Alert, Badge, Button, Card, DataTable, Field, Input, Modal, PageHeader, Pagination, Select, Tabs, Textarea, cx } from '../../components/ui';

export default function Stock() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'saldo' | 'mov'>('saldo');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [adj, setAdj] = useState<{ productId: string; label: string } | null>(null);
  const [form, setForm] = useState({ type: 'IN', quantity: '', reason: '' });
  const dq = useDebounced(q);
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<any>('/admin/settings') });
  const stock = useQuery({ queryKey: ['stock', dq, page], queryFn: () => api<any>('/admin/stock', { query: { q: dq, page } }), placeholderData: keepPreviousData, enabled: tab === 'saldo' });
  const movs = useQuery({ queryKey: ['stock-movs', page], queryFn: () => api<any>('/admin/stock/movements', { query: { page } }), placeholderData: keepPreviousData, enabled: tab === 'mov' });
  const save = useMutation({
    mutationFn: () => api('/admin/stock/adjust', { body: { productId: adj!.productId, type: form.type === 'ADJUST_OUT' ? 'ADJUST' : form.type, quantity: parseInt(form.quantity, 10) * (form.type === 'ADJUST_OUT' ? -1 : 1), reason: form.reason } }),
    onSuccess: () => { toast.success('Movimentação registrada.'); setAdj(null); setForm({ type: 'IN', quantity: '', reason: '' }); void qc.invalidateQueries({ queryKey: ['stock'] }); void qc.invalidateQueries({ queryKey: ['stock-movs'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = settings.data;
  return (
    <>
      <PageHeader title="Estoque" subtitle="Saldos por SKU, reservas e histórico de movimentações" />
      {s && (s.stockEnabled ? (
        <div className="mb-4"><Alert tone="green" title="Controle de estoque habilitado">Política: {STOCK_POLICY_LABELS[s.stockPolicy as keyof typeof STOCK_POLICY_LABELS]}. {s.blockOnInsufficientStock ? 'Pedidos sem saldo são bloqueados.' : 'Pedidos sem saldo são permitidos.'} Orçamentos nunca movimentam estoque.</Alert></div>
      ) : (
        <div className="mb-4"><Alert tone="amber" title="Controle de estoque desabilitado (pendente de integração)">Os saldos abaixo são informativos e os pedidos não reservam nem baixam estoque. Habilite em Configurações → Comercial quando os saldos estiverem conferidos ou integrados ao sistema de estoque da empresa.</Alert></div>
      ))}
      <Tabs value={tab} onChange={(t) => { setTab(t); setPage(1); }} tabs={[{ value: 'saldo', label: 'Saldos' }, { value: 'mov', label: 'Movimentações' }]} />
      <Card padded={false}>
        {tab === 'saldo' ? (
          <>
            <div className="border-b border-line p-4"><Input placeholder="Pesquisar por nome ou SKU" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
            <DataTable rows={stock.data?.items} loading={stock.isFetching} rowKey={(r: any) => r.id}
              columns={[
                { key: 'p', header: 'Produto', render: (r: any) => (<div><p className="font-medium text-navy-900">{r.name}</p><p className="text-xs text-muted">{r.sku} • {r.brand.name}</p></div>) },
                { key: 's', header: 'Físico', align: 'right', render: (r: any) => r.stockQty },
                { key: 'r', header: 'Reservado', align: 'right', render: (r: any) => r.reservedQty },
                { key: 'a', header: 'Disponível', align: 'right', render: (r: any) => <span className={cx('font-medium', r.availableQty <= 0 && 'text-red-600')}>{r.availableQty} {r.unit}</span> },
                { key: 'st', header: '', render: (r: any) => (!r.active ? <Badge>Inativo</Badge> : null) },
                { key: 'act', header: '', align: 'right', render: (r: any) => <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setAdj({ productId: r.id, label: `${r.sku} – ${r.name}` })}>Movimentar</Button> },
              ]} />
            {stock.data && <Pagination page={stock.data.page} pages={stock.data.pages} total={stock.data.total} onPage={setPage} />}
          </>
        ) : (
          <>
            <DataTable rows={movs.data?.items} loading={movs.isFetching} rowKey={(r: any) => r.id}
              columns={[
                { key: 'd', header: 'Data', render: (r: any) => formatDateTimeBR(r.createdAt) },
                { key: 'p', header: 'Produto', render: (r: any) => `${r.product.sku} – ${r.product.name}` },
                { key: 't', header: 'Tipo', render: (r: any) => STOCK_MOVEMENT_LABELS[r.type as keyof typeof STOCK_MOVEMENT_LABELS] },
                { key: 'q', header: 'Qtd.', align: 'right', render: (r: any) => (r.quantity > 0 ? `+${r.quantity}` : r.quantity) },
                { key: 'af', header: 'Saldo após', align: 'right', hideOnMobile: true, render: (r: any) => `${r.stockAfter} (res. ${r.reservedAfter})` },
                { key: 'o', header: 'Pedido/Motivo', render: (r: any) => r.order?.number ?? r.reason },
                { key: 'u', header: 'Responsável', hideOnMobile: true, render: (r: any) => r.user.name },
              ]} />
            {movs.data && <Pagination page={movs.data.page} pages={movs.data.pages} total={movs.data.total} onPage={setPage} />}
          </>
        )}
      </Card>
      <Modal open={!!adj} onClose={() => setAdj(null)} title="Movimentar estoque" footer={<><Button variant="secondary" onClick={() => setAdj(null)}>Cancelar</Button><Button loading={save.isPending} onClick={() => save.mutate()} disabled={!form.quantity || !form.reason}>Registrar</Button></>}>
        <p className="mb-4 text-sm font-medium">{adj?.label}</p>
        <div className="space-y-4">
          <Field label="Tipo">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="IN">Entrada</option>
              <option value="RETURN">Devolução</option>
              <option value="ADJUST">Ajuste (acréscimo)</option>
              <option value="ADJUST_OUT">Ajuste (redução)</option>
            </Select>
          </Field>
          <Field label="Quantidade"><Input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
          <Field label="Justificativa (obrigatória)"><Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}
