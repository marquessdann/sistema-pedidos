/**
 * Teste de aceite ponta a ponta no navegador (Playwright), simulando celular e tablet.
 * Roda contra um servidor em execução (ex.: `npm run preview:cloud`, que simula o Vercel).
 *
 * Uso:
 *   BASE_URL=http://localhost:3000 ADMIN_USER=daniel ADMIN_PASS='...' VICTOR_PASS='...' node e2e/acceptance.cjs
 * Use um banco de TESTE: o roteiro cadastra cliente e produtos marcados como "Teste automático".
 * Screenshots em e2e/screenshots/.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_USER = process.env.ADMIN_USER || 'daniel';
const ADMIN_PASS = process.env.ADMIN_PASS;
const VICTOR_USER = process.env.VICTOR_USER || 'Victor';
const VICTOR_PASS = process.env.VICTOR_PASS;
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString().slice(-5);

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'pt-BR', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
const TABLET = { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, locale: 'pt-BR' };

function cnpj(base8) {
  const b = (base8 + '0001').split('').map(Number);
  const dv = (arr) => { const w = arr.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; const r = arr.reduce((a, n, i) => a + n * w[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(b); const d2 = dv([...b, d1]);
  return [...b, d1, d2].join('');
}
async function shot(page, name) { await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }); console.log('  📸', name); }
const step = (m) => console.log(`\n▶ ${m}`);
const card = (page, text) => page.locator('div.rounded-2xl', { hasText: text }).first();

async function login(page, user, pass) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Usuário').fill(user);
  await page.getByLabel('Senha', { exact: true }).fill(pass);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

(async () => {
  if (!ADMIN_PASS || !VICTOR_PASS) throw new Error('Defina ADMIN_PASS e VICTOR_PASS');
  const browser = await chromium.launch();
  const clientCnpj = cnpj('77' + RUN + '0');
  const clientName = `Mercado Teste Automático ${RUN} Ltda`;
  const prodA = `Shampoo Teste ${RUN}`;
  const prodB = `Condicionador Teste ${RUN}`;

  // ------------------------------------------------------------- Daniel (tablet)
  const a = await (await browser.newContext(TABLET)).newPage();
  a.on('pageerror', (e) => console.log('  ⚠ erro de página:', e.message));
  step('Daniel entra pelo tablet');
  await login(a, 'Daniel', ADMIN_PASS);
  await a.getByText('Visão geral comercial').waitFor();
  await shot(a, 'tablet-01-dashboard');

  step('Cadastra cliente colando o texto do WhatsApp');
  await a.goto(`${BASE}/admin/clientes/novo`);
  await a.getByRole('button', { name: /Importar texto/ }).click();
  await a.getByRole('dialog').locator('textarea').fill(`Razão social: ${clientName}\nNome fantasia: Mercado Teste ${RUN}\nCNPJ: ${clientCnpj}\nResponsável: Maria\nTelefone comercial: (11) 98888-7777\nCidade: São Paulo/SP`);
  await a.getByRole('button', { name: 'Preencher formulário' }).click();
  await a.getByLabel(/Status do cadastro/).selectOption('ACTIVE');
  await a.getByLabel(/Vendedor responsável/).selectOption({ label: 'Victor Badur' });
  await a.getByRole('button', { name: 'Salvar cliente' }).click();
  await a.getByText('Cliente cadastrado.').waitFor();

  step('Cadastra marca e produtos (um vendido também por caixa com 12)');
  await a.goto(`${BASE}/admin/marcas`);
  await a.getByRole('button', { name: 'Nova' }).first().click();
  await a.getByRole('dialog').getByLabel(/Nome/).fill(`Marca Teste ${RUN}`);
  await a.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click();
  await a.getByText('Salvo.').waitFor();
  for (const [name, sku, price, cost, box] of [[prodA, `TST-${RUN}-A`, '15,00', '8,00', '12'], [prodB, `TST-${RUN}-B`, '8,99', '4,00', '']]) {
    await a.goto(`${BASE}/admin/produtos/novo`);
    await a.getByLabel(/Código \/ SKU/).fill(sku);
    await a.getByLabel(/Nome do produto/).fill(name);
    await a.getByLabel(/^Marca/).selectOption({ label: `Marca Teste ${RUN}` });
    if (box) await a.getByLabel(/Unidades por caixa/).fill(box);
    await a.getByLabel(/Preço de custo/).fill(cost);
    await a.getByLabel(/Preço de venda/).fill(price);
    if (box) await shot(a, 'tablet-02-produto-caixa');
    await a.getByRole('button', { name: 'Salvar produto' }).click();
    await a.getByText(/Produto cadastrado/).waitFor();
  }
  console.log('  ✔ cliente e produtos cadastrados');

  // ------------------------------------------------------------- Victor (iPhone)
  const v = await (await browser.newContext(PHONE)).newPage();
  v.on('pageerror', (e) => console.log('  ⚠ erro de página:', e.message));
  step('Victor entra pelo celular (usuário "Victor")');
  await login(v, VICTOR_USER, VICTOR_PASS);
  await v.getByText('Bem-vindo, Victor Badur').waitFor();
  await shot(v, 'phone-01-inicio');

  step('Seleciona o cliente');
  await v.getByPlaceholder(/Pesquise por razão social/).fill(`Teste ${RUN}`);
  await v.getByRole('button', { name: new RegExp(`Mercado Teste ${RUN}`) }).first().click();
  await v.getByText('Cliente selecionado').waitFor();
  await shot(v, 'phone-02-cliente');

  step('Novo pedido: 2 caixas + 10 unidades, desconto de 5%');
  await v.getByRole('button', { name: /Realizar novo pedido/ }).click();
  await v.getByPlaceholder(/Buscar produto/).fill(`Teste ${RUN}`);
  await card(v, prodA).waitFor();
  const cA = card(v, prodA);
  await cA.getByRole('button', { name: 'CX 12' }).click();
  await cA.getByRole('button', { name: 'Aumentar' }).click();
  await shot(v, 'phone-03-produto-caixa');
  await cA.getByRole('button', { name: `Adicionar ${prodA}` }).click();
  const cB = card(v, prodB);
  await cB.getByLabel('Quantidade').fill('10');
  await cB.getByRole('button', { name: `Adicionar ${prodB}` }).click();
  await v.waitForTimeout(400);
  await shot(v, 'phone-04-produtos');
  await v.getByRole('button', { name: /Revisar/ }).click();
  await v.getByRole('button', { name: '5%', exact: true }).click();
  // 2 CX × (15,00 × 12) = 360,00 ; 10 × 8,99 = 89,90 ; subtotal 449,90 ; 5% = 22,50 (22,495 arred.) ; total 427,40
  const bar = await v.locator('div.fixed.bottom-0').innerText();
  if (!bar.includes('427,40')) throw new Error('Total esperado R$ 427,40 — barra: ' + bar);
  console.log('  ✔ total R$ 427,40 (subtotal R$ 449,90 − 5%)');
  await shot(v, 'phone-05-revisao');
  await v.getByLabel('Condição de pagamento').selectOption({ index: 2 });
  await v.getByRole('button', { name: /Continuar/ }).click();
  await v.getByText('Valores validados pelo servidor.').waitFor();
  await shot(v, 'phone-06-confirmar');
  await v.getByRole('button', { name: 'Confirmar pedido' }).click();
  await v.getByRole('dialog').getByRole('button', { name: 'Confirmar pedido' }).click();
  await v.getByText('Pedido confirmado com sucesso').waitFor();
  const orderNumber = (await v.locator('h1').innerText()).match(/PED-\d{4}-\d{6}/)[0];
  console.log('  ✔ Pedido', orderNumber);

  step('Gera o PDF');
  await v.getByRole('button', { name: 'Gerar PDF' }).click();
  await v.getByText('PDF gerado com sucesso.').waitFor();
  const href = await v.getByRole('link', { name: 'Baixar' }).getAttribute('href');
  const pdf = await v.request.get(`${BASE}${href}`);
  const buf = await pdf.body();
  if (pdf.status() !== 200 || buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF inválido');
  fs.writeFileSync(path.join(SHOTS, 'pedido.pdf'), buf);
  console.log(`  ✔ PDF ok (${buf.length} bytes)`);
  await shot(v, 'phone-07-pedido');

  step('Daniel aprova no tablet; Victor vê o andamento no celular');
  await a.goto(`${BASE}/admin/pedidos`);
  await a.getByText(orderNumber, { exact: true }).filter({ visible: true }).first().click();
  await a.getByRole('button', { name: 'Alterar status' }).click();
  await a.getByRole('dialog').getByLabel(/Novo status/).selectOption('APPROVED');
  await a.getByRole('dialog').getByLabel(/Observação/).fill('Crédito aprovado');
  await a.getByRole('button', { name: 'Confirmar alteração' }).click();
  await a.getByText('Status atualizado.').waitFor();
  await shot(a, 'tablet-03-pedido');
  await v.getByRole('link', { name: 'Andamento' }).click();
  await v.getByRole('button', { name: new RegExp(orderNumber) }).click();
  await v.getByText('Crédito aprovado').waitFor();
  await shot(v, 'phone-08-andamento');

  step('Orçamento no celular e conversão em pedido');
  await v.getByRole('link', { name: 'Início' }).click();
  await v.getByRole('button', { name: /Fazer orçamento/ }).click();
  await v.getByPlaceholder(/Buscar produto/).fill(prodB);
  await card(v, prodB).getByLabel('Quantidade').fill('20');
  await card(v, prodB).getByRole('button', { name: `Adicionar ${prodB}` }).click();
  await v.getByRole('button', { name: /Revisar/ }).click();
  await v.getByRole('button', { name: '3%', exact: true }).click();
  await v.getByRole('button', { name: /Continuar/ }).click();
  await v.getByText('Valores validados pelo servidor.').waitFor();
  await v.getByRole('button', { name: 'Salvar e gerar PDF' }).click();
  await v.getByText('Orçamento salvo', { exact: true }).waitFor();
  await shot(v, 'phone-09-orcamento');
  await v.getByRole('button', { name: 'Transformar em pedido' }).click();
  await v.getByRole('dialog').getByText('Revisar condições comerciais').waitFor();
  await shot(v, 'phone-10-converter');
  await v.getByRole('button', { name: 'Confirmar e criar pedido' }).click();
  await v.getByText(/criado a partir do orçamento/).waitFor();
  console.log('  ✔ orçamento convertido em pedido');
  await v.getByRole('link', { name: 'Pedidos' }).click();
  await v.waitForTimeout(600);
  await shot(v, 'phone-11-pedidos');

  await browser.close();
  console.log('\n✅ Fluxo completo validado no celular e no tablet.');
})().catch((e) => {
  console.error('\n❌ FALHA:', e.message);
  process.exit(1);
});
