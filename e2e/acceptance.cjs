/**
 * Teste de aceite ponta a ponta no navegador (Playwright).
 * Executa o roteiro do critério final de aceite contra um servidor em execução.
 *
 * Uso:  BASE_URL=http://localhost:3333 ADMIN_USER=admin ADMIN_PASS='...' VICTOR_PASS='1234' node e2e/acceptance.cjs
 * Pré-requisito: banco com seed aplicado (npm run db:seed). Gera screenshots em e2e/screenshots/.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3333';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS;
const VICTOR_PASS = process.env.VICTOR_PASS || '1234';
const VICTOR_NEW = process.env.VICTOR_NEW || 'Badur2026Della';
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString().slice(-6);

// CNPJ fictício válido gerado a partir do timestamp
function cnpj(base8) {
  const b = (base8 + '0001').split('').map(Number);
  const dv = (arr) => { const w = arr.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; const r = arr.reduce((a, n, i) => a + n * w[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(b); const d2 = dv([...b, d1]);
  return [...b, d1, d2].join('');
}

async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); console.log('  📸', name); }
const step = (m) => console.log(`\n▶ ${m}`);

(async () => {
  if (!ADMIN_PASS) throw new Error('Defina ADMIN_PASS');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  ⚠ erro de página:', e.message));
  const clientCnpj = cnpj('62' + RUN);
  const clientName = `Cliente Aceite ${RUN} Ltda`;
  const skuA = `ACE-${RUN}-A`;
  const skuB = `ACE-${RUN}-B`;

  step('Login do administrador');
  await page.goto(`${BASE}/login`);
  await shot(page, '01-login');
  await page.getByLabel('Usuário').fill(ADMIN_USER);
  await page.getByLabel('Senha', { exact: true }).fill(ADMIN_PASS);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByText('Visão geral comercial').waitFor();
  await page.waitForTimeout(500);
  await shot(page, '02-admin-dashboard');

  step('Cadastrar cliente (com importação de texto do WhatsApp)');
  await page.goto(`${BASE}/admin/clientes/novo`);
  await page.getByRole('button', { name: /Importar texto/ }).click();
  await page.getByRole('dialog').locator('textarea').fill(`Razão social: ${clientName}\nNome fantasia: Aceite ${RUN}\nCNPJ: ${clientCnpj}\nResponsável: Maria Teste\nE-mail financeiro: financeiro@aceite.test\nTelefone comercial: (11) 98888-7777\nCEP: 01310-100\nEndereço: Av. Paulista, 1000 - Sala 5\nBairro: Bela Vista\nCidade: São Paulo/SP`);
  await page.waitForTimeout(300);
  await shot(page, '03-import-whatsapp');
  await page.getByRole('button', { name: 'Preencher formulário' }).click();
  await page.getByLabel(/Status do cadastro/).selectOption('ACTIVE');
  await page.getByLabel(/Vendedor responsável/).selectOption({ label: 'Victor Badur' });
  await shot(page, '04-client-form');
  await page.getByRole('button', { name: 'Salvar cliente' }).click();
  await page.getByText('Cliente cadastrado.').waitFor();
  console.log('  ✔ cliente cadastrado e ativado para o Victor');

  step('Cadastrar produtos com preços');
  for (const [sku, name, price, cost] of [[skuA, `Produto Aceite A ${RUN}`, '150,00', '80,00'], [skuB, `Produto Aceite B ${RUN}`, '89,90', '40,00']]) {
    await page.goto(`${BASE}/admin/produtos/novo`);
    await page.getByLabel(/Código \/ SKU/).fill(sku);
    await page.getByLabel(/Nome do produto/).fill(name);
    const brandSel = page.getByLabel(/^Marca/);
    const opts = await brandSel.locator('option').allTextContents();
    await brandSel.selectOption({ label: opts[sku.endsWith('A') ? 1 : Math.min(2, opts.length - 1)] });
    await page.getByLabel(/Preço de custo/).fill(cost);
    await page.getByLabel(/Preço de venda/).fill(price);
    if (sku.endsWith('A')) await shot(page, '05-product-form');
    await page.getByRole('button', { name: 'Salvar produto' }).click();
    await page.getByText(/Produto cadastrado/).waitFor();
  }
  console.log('  ✔ 2 produtos cadastrados');
  await page.goto(`${BASE}/admin/produtos`);
  await page.waitForTimeout(600);
  await shot(page, '06-products-list');

  step('Login como Victor Badur (troca obrigatória de senha)');
  const v = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  const vp = await v.newPage();
  vp.on('pageerror', (e) => console.log('  ⚠ erro de página:', e.message));
  await vp.goto(`${BASE}/login`);
  await vp.getByLabel('Usuário').fill('victor');
  let pass = VICTOR_PASS;
  await vp.getByLabel('Senha', { exact: true }).fill(pass);
  await vp.getByRole('button', { name: 'Entrar' }).click();
  await vp.waitForURL(/trocar-senha|vendedor/);
  if (vp.url().includes('trocar-senha')) {
    await shot(vp, '07-change-password');
    await vp.getByLabel(/Senha atual/).fill(pass);
    await vp.getByLabel('Nova senha', { exact: true }).fill(VICTOR_NEW);
    await vp.getByLabel(/Confirme/).fill(VICTOR_NEW);
    await vp.getByRole('button', { name: 'Salvar nova senha' }).click();
    pass = VICTOR_NEW;
  }
  await vp.getByText('Bem-vindo, Victor Badur').waitFor();
  console.log('  ✔ "Bem-vindo, Victor Badur"');

  step('Selecionar o cliente');
  await vp.getByPlaceholder(/Pesquise por razão social/).fill(clientCnpj.slice(0, 8));
  await vp.waitForTimeout(700);
  await shot(vp, '08-seller-select-client');
  await vp.getByRole('button', { name: new RegExp(`Aceite ${RUN}`) }).first().click();
  await vp.getByText('Cliente selecionado').waitFor();
  await shot(vp, '09-seller-client-panel');

  step('Montar pedido com vários produtos e desconto');
  await vp.getByRole('button', { name: /Realizar novo pedido/ }).click();
  await vp.getByText('Dados do pedido').first().waitFor();
  await vp.getByLabel(/Condição de pagamento/).selectOption({ index: 3 });
  await vp.getByLabel(/Observações do pedido/).fill('Entregar no período da manhã.');
  await shot(vp, '10-wizard-step1');
  await vp.getByRole('button', { name: 'Avançar' }).click();
  await vp.getByPlaceholder(/Pesquisar produto/).fill(`ACE-${RUN}`);
  await vp.waitForTimeout(800);
  await vp.getByLabel(`Quantidade de Produto Aceite A ${RUN}`).fill('4');
  await vp.getByRole('button', { name: 'Adicionar ao pedido' }).first().click();
  await vp.getByLabel(`Quantidade de Produto Aceite B ${RUN}`).fill('10');
  await vp.getByRole('button', { name: 'Adicionar ao pedido' }).first().click();
  // adiciona de novo o produto A para testar a soma de quantidade
  await vp.getByLabel(`Quantidade de Produto Aceite A ${RUN}`).fill('1');
  await vp.getByRole('button', { name: /No pedido \(4\)/ }).click();
  await vp.getByRole('button', { name: 'Somar quantidade' }).click();
  await vp.waitForTimeout(400);
  await shot(vp, '11-wizard-products');
  await vp.getByRole('button', { name: 'Avançar' }).click();
  await shot(vp, '12-wizard-review');
  await vp.getByRole('button', { name: 'Avançar' }).click();
  // 5 x 150 = 750 ; 10 x 89,90 = 899 ; subtotal 1.649,00 ; 5% = 82,45 ; total 1.566,55
  await vp.getByLabel('Desconto do vendedor em percentual').fill('5');
  await vp.waitForTimeout(300);
  const bar = await vp.locator('div.fixed.bottom-0').innerText();
  if (!bar.includes('1.566,55')) throw new Error('Total esperado R$ 1.566,55 não encontrado: ' + bar);
  console.log('  ✔ total calculado R$ 1.566,55 (subtotal 1.649,00 − 5%)');
  await shot(vp, '13-wizard-finance');
  // excedendo o limite
  await vp.getByLabel('Desconto do vendedor em percentual').fill('8');
  await vp.getByText('Desconto acima do seu limite').waitFor();
  await shot(vp, '14-wizard-over-limit');
  await vp.getByLabel('Desconto do vendedor em percentual').fill('5');
  await vp.getByRole('button', { name: 'Avançar' }).click();
  await vp.getByText('Valores validados pelo servidor.').waitFor();
  await shot(vp, '15-wizard-confirm');
  await vp.getByRole('button', { name: 'Confirmar pedido' }).click();
  await vp.getByRole('dialog').getByRole('button', { name: 'Confirmar pedido' }).click();
  await vp.getByText('Pedido confirmado com sucesso').waitFor();
  const orderTitle = await vp.locator('h1').innerText();
  console.log('  ✔', orderTitle.split('\n')[0]);

  step('Gerar o PDF');
  await vp.getByRole('button', { name: 'Gerar PDF' }).click();
  await vp.getByText('PDF gerado com sucesso.').waitFor();
  const href = await vp.getByRole('link', { name: 'Baixar' }).getAttribute('href');
  const pdf = await vp.request.get(`${BASE}${href}`);
  const buf = await pdf.body();
  if (pdf.status() !== 200 || buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF inválido');
  fs.writeFileSync(path.join(SHOTS, 'pedido.pdf'), buf);
  console.log(`  ✔ PDF baixado (${buf.length} bytes) → e2e/screenshots/pedido.pdf`);
  await shot(vp, '16-order-view');

  step('Consultar o andamento');
  await vp.getByRole('link', { name: /Processo do pedido/ }).first().click();
  await vp.getByText('Selecione um pedido', { exact: true }).waitFor();
  await vp.locator('ul button').first().click();
  await vp.getByText('Pedido criado').first().waitFor();
  await shot(vp, '17-order-process');

  step('Admin avança o status; vendedor vê a linha do tempo');
  await page.goto(`${BASE}/admin/pedidos`);
  await page.waitForTimeout(600);
  await shot(page, '18-admin-orders');
  await page.locator('tbody tr').first().click();
  await page.getByRole('button', { name: 'Alterar status' }).click();
  await page.getByRole('dialog').getByLabel(/Novo status/).selectOption('APPROVED');
  await page.getByRole('dialog').getByLabel(/Observação/).fill('Crédito aprovado');
  await page.getByRole('button', { name: 'Confirmar alteração' }).click();
  await page.getByText('Status atualizado.').waitFor();
  await shot(page, '19-admin-order-detail');
  await vp.reload();
  await vp.getByText('Crédito aprovado').waitFor();
  console.log('  ✔ vendedor vê "Pedido aprovado" com a observação');

  step('Criar orçamento e transformar em pedido (sem duplicação)');
  await vp.goto(`${BASE}/vendedor`);
  await vp.getByRole('button', { name: /Fazer orçamento/ }).click();
  await vp.getByRole('button', { name: 'Avançar' }).click();
  await vp.getByPlaceholder(/Pesquisar produto/).fill(skuB);
  await vp.waitForTimeout(800);
  await vp.getByLabel(`Quantidade de Produto Aceite B ${RUN}`).fill('20');
  await vp.getByRole('button', { name: 'Adicionar ao pedido' }).first().click();
  await vp.getByRole('button', { name: 'Avançar' }).click();
  await vp.getByRole('button', { name: 'Avançar' }).click();
  await vp.getByLabel('Desconto do vendedor em percentual').fill('3');
  await vp.getByRole('button', { name: 'Avançar' }).click();
  await vp.getByText('Valores validados pelo servidor.').waitFor();
  await vp.getByRole('button', { name: 'Salvar e gerar PDF' }).click();
  await vp.getByText('Orçamento salvo', { exact: true }).waitFor();
  await vp.waitForTimeout(500);
  await shot(vp, '20-quote-view');
  await vp.getByRole('button', { name: 'Transformar em pedido' }).click();
  await vp.getByRole('dialog').getByText('Revisar condições comerciais').waitFor();
  await shot(vp, '21-quote-convert');
  await vp.getByRole('button', { name: 'Confirmar e criar pedido' }).click();
  await vp.getByText(/criado a partir do orçamento/).waitFor();
  await vp.waitForTimeout(400);
  await shot(vp, '22-converted-order');
  await vp.goBack();
  await vp.goBack();
  await vp.waitForTimeout(800);
  const hasConvertBtn = await vp.getByRole('button', { name: 'Transformar em pedido' }).count();
  if (hasConvertBtn) throw new Error('Botão de conversão ainda disponível após converter');
  console.log('  ✔ orçamento convertido; botão de conversão não aparece mais');

  step('Visual em celular');
  const m = await ctx.browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, locale: 'pt-BR', storageState: await v.storageState() });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/vendedor`);
  await mp.waitForTimeout(800);
  await shot(mp, '23-mobile-home');
  await mp.goto(`${BASE}/vendedor/pedidos`);
  await mp.waitForTimeout(800);
  await shot(mp, '24-mobile-orders');

  await browser.close();
  console.log('\n✅ Critério de aceite validado ponta a ponta.');
})().catch((e) => {
  console.error('\n❌ FALHA:', e.message);
  process.exit(1);
});
