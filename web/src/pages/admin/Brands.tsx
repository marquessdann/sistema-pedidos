import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { Badge, Button, Card, CardTitle, Field, Input, Modal, PageHeader, Toggle } from '../../components/ui';

interface Item {
  id: string;
  name: string;
  active: boolean;
  productCount: number;
  sortOrder?: number;
}

function Section({ kind, title }: { kind: 'brands' | 'categories'; title: string }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [edit, setEdit] = useState<Partial<Item> | null>(null);
  const list = useQuery({ queryKey: [kind], queryFn: () => api<Item[]>(`/admin/${kind}`) });
  const save = useMutation({
    mutationFn: (it: Partial<Item>) =>
      it.id
        ? api(`/admin/${kind}/${it.id}`, { method: 'PUT', body: { name: it.name, active: it.active ?? true, ...(kind === 'brands' ? { sortOrder: it.sortOrder ?? 0 } : {}) } })
        : api(`/admin/${kind}`, { body: { name: it.name, active: it.active ?? true, ...(kind === 'brands' ? { sortOrder: it.sortOrder ?? 0 } : {}) } }),
    onSuccess: () => {
      toast.success('Salvo.');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: [kind] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardTitle actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({ name: '', active: true, sortOrder: 0 })}>Nova</Button>}>{title}</CardTitle>
      <ul className="divide-y divide-line">
        {list.data?.map((it) => (
          <li key={it.id} className="flex items-center justify-between gap-3 py-2.5">
            <button className="min-w-0 text-left" onClick={() => nav(`/admin/produtos?${kind === 'brands' ? 'brandId' : 'categoryId'}=${it.id}`)}>
              <p className="truncate font-medium text-navy-900 hover:underline">{it.name}</p>
              <p className="text-xs text-muted">{it.productCount} produto(s)</p>
            </button>
            <div className="flex items-center gap-2">
              {!it.active && <Badge>Inativa</Badge>}
              <Button size="sm" variant="ghost" aria-label="Editar" icon={<Pencil className="size-4" />} onClick={() => setEdit(it)} />
            </div>
          </li>
        ))}
        {list.data?.length === 0 && <li className="py-6 text-center text-sm text-muted">Nenhum cadastro.</li>}
      </ul>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? `Editar ${kind === 'brands' ? 'marca' : 'categoria'}` : `Nova ${kind === 'brands' ? 'marca' : 'categoria'}`}
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button><Button loading={save.isPending} onClick={() => edit && save.mutate(edit)}>Salvar</Button></>}
      >
        {edit && (
          <div className="space-y-4">
            <Field label="Nome" required><Input autoFocus value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            {kind === 'brands' && <Field label="Ordem de exibição" hint="Menor aparece primeiro no catálogo."><Input type="number" value={edit.sortOrder ?? 0} onChange={(e) => setEdit({ ...edit, sortOrder: parseInt(e.target.value || '0', 10) })} /></Field>}
            <Toggle checked={edit.active ?? true} onChange={(v) => setEdit({ ...edit, active: v })} label="Ativa" description={kind === 'brands' ? 'Marcas inativas escondem todos os seus produtos do vendedor.' : undefined} />
          </div>
        )}
      </Modal>
    </Card>
  );
}

export default function Brands() {
  return (
    <>
      <PageHeader title="Marcas e categorias" subtitle="Organização do catálogo exibido aos vendedores (Marca → Produtos)" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section kind="brands" title="Marcas" />
        <Section kind="categories" title="Categorias" />
      </div>
    </>
  );
}
