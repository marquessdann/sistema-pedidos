import { describe, expect, it } from 'vitest';
import { formatCep, formatCnpj, formatCpf, formatPhone, isValidCnpj, isValidCpf } from '../src/documents';
import { parseClientText } from '../src/clientParser';
import { formatDateBR, startOfDayInTz, todayInTz } from '../src/dates';

describe('CNPJ / CPF', () => {
  it('valida CNPJ numérico', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
    expect(isValidCnpj('123')).toBe(false);
  });
  it('valida CNPJ alfanumérico (exemplo oficial da Receita)', () => {
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12.ABC.345/01DE-36')).toBe(false);
  });
  it('formata', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
    expect(formatPhone('11987654321')).toBe('(11) 98765-4321');
    expect(formatPhone('1134567890')).toBe('(11) 3456-7890');
    expect(formatCep('01310100')).toBe('01310-100');
  });
  it('valida CPF', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('111.111.111-11')).toBe(false);
  });
});

describe('importação de texto do WhatsApp', () => {
  it('identifica campos rotulados', () => {
    const { data } = parseClientText(`*Razão social:* Mercado Exemplo Ltda
Nome fantasia: Mercadinho Exemplo
CNPJ: 11.222.333/0001-81
Responsável - João da Silva
E-mail financeiro: FIN@exemplo.com.br
Telefone financeiro: 11 3456-7890
Telefone comercial: (11) 98765-4321
E-mail comercial: compras@exemplo.com.br
CEP: 01310100
Endereço: Av. Paulista, 1000 - Sala 12
Bairro: Bela Vista
Cidade: São Paulo/SP`);
    expect(data.legalName).toBe('Mercado Exemplo Ltda');
    expect(data.tradeName).toBe('Mercadinho Exemplo');
    expect(data.cnpj).toBe('11.222.333/0001-81');
    expect(data.responsibleName).toBe('João da Silva');
    expect(data.financeEmail).toBe('fin@exemplo.com.br');
    expect(data.financePhone).toBe('(11) 3456-7890');
    expect(data.commercialPhone).toBe('(11) 98765-4321');
    expect(data.commercialEmail).toBe('compras@exemplo.com.br');
    expect(data.cep).toBe('01310-100');
    expect(data.street).toBe('Av. Paulista');
    expect(data.number).toBe('1000');
    expect(data.complement).toBe('Sala 12');
    expect(data.city).toBe('São Paulo');
    expect(data.state).toBe('SP');
  });
  it('detecta campos sem rótulo', () => {
    const { data, unrecognized } = parseClientText('11222333000181\ncontato@x.com\n(21) 99999-0000\nalgo solto');
    expect(data.cnpj).toBe('11.222.333/0001-81');
    expect(data.commercialEmail).toBe('contato@x.com');
    expect(data.commercialPhone).toBe('(21) 99999-0000');
    expect(unrecognized).toEqual(['algo solto']);
  });
});

describe('datas', () => {
  it('usa o fuso de São Paulo', () => {
    expect(todayInTz('America/Sao_Paulo', new Date('2026-11-02T02:00:00Z'))).toBe('2026-11-01');
    expect(formatDateBR('2026-11-02')).toBe('02/11/2026');
    expect(startOfDayInTz('2026-11-02').toISOString()).toBe('2026-11-02T03:00:00.000Z');
  });
});
