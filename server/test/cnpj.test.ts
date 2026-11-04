import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Agent, loginVictor, makeApp, seedBase } from './helpers';
import { clearCnpjCache } from '../src/modules/cnpj';

// Respostas no formato documentado de cada serviço público (a rede externa não é acessada nos testes)
const brasilApi = {
  cnpj: '57534374000104',
  razao_social: 'DELLA COMERCIO E DISTRIBUIDORA DE PRODUTOS LTDA',
  nome_fantasia: '',
  descricao_situacao_cadastral: 'ATIVA',
  descricao_tipo_de_logradouro: 'RUA',
  logradouro: 'ASSIS FIGUEIREDO',
  numero: '59',
  complemento: '',
  bairro: 'PAROLIN',
  municipio: 'CURITIBA',
  uf: 'PR',
  cep: '80630280',
  ddd_telefone_1: '4196790904',
  email: 'FINANCEIRO@DELLASTORE.COM.BR',
  cnae_fiscal_descricao: 'Comércio atacadista de cosméticos e produtos de perfumaria',
};
const receitaWs = {
  status: 'OK',
  nome: 'EMPRESA BAIXADA LTDA',
  fantasia: 'BAIXADA',
  situacao: 'BAIXADA',
  logradouro: 'AV BRASIL',
  numero: '10',
  bairro: 'CENTRO',
  municipio: 'SAO PAULO',
  uf: 'SP',
  cep: '01.000-000',
  telefone: '(11) 3456-7890 / (11) 98888-7777',
  email: '',
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let app: FastifyInstance;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await seedBase();
  clearCnpjCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('Consulta de CNPJ (Receita Federal)', () => {
  it('preenche razão social, endereço, telefone e e-mail; IE não vem da Receita', async () => {
    const fetchMock = vi.fn(async () => json(200, brasilApi));
    vi.stubGlobal('fetch', fetchMock);
    const v = await loginVictor(app);
    const r = await v.get('/api/cnpj/57.534.374%2F0001-04'.replace('%2F', ''));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      legalName: 'DELLA COMERCIO E DISTRIBUIDORA DE PRODUTOS LTDA',
      tradeName: null,
      status: 'ATIVA',
      statusOk: true,
      street: 'Rua Assis Figueiredo',
      number: '59',
      district: 'Parolin',
      city: 'Curitiba',
      state: 'PR',
      cep: '80630280',
      phone: '4196790904',
      email: 'financeiro@dellastore.com.br',
      source: 'BrasilAPI',
    });
    expect(r.body).not.toHaveProperty('stateRegistration');
    // segunda consulta vem do cache
    await v.get('/api/cnpj/57534374000104');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('se uma fonte cair, usa a próxima e avisa CNPJ não ativo', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('receitaws') ? json(200, receitaWs) : json(503, {}))));
    const v = await loginVictor(app);
    const r = await v.get('/api/cnpj/11222333000181');
    expect(r.body).toMatchObject({ source: 'ReceitaWS', status: 'BAIXADA', statusOk: false, phone: '1134567890', cep: '01000000', city: 'Sao Paulo' });
  });

  it('CNPJ inexistente, inválido, sem login e serviço fora do ar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(404, { message: 'not found' })));
    const v = await loginVictor(app);
    expect((await v.get('/api/cnpj/11222333000181')).status).toBe(404);
    expect((await v.get('/api/cnpj/11222333000182')).status).toBe(400);
    expect((await new Agent(app).get('/api/cnpj/11222333000181')).status).toBe(401);
    clearCnpjCache();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const down = await v.get('/api/cnpj/11222333000181');
    expect(down.status).toBe(503);
    expect(down.body.error).toBe('CNPJ_LOOKUP_UNAVAILABLE');
  });
});
