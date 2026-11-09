/**
 * Teste ponta a ponta do modo sem internet (Playwright, iPhone simulado).
 * Roda contra um servidor em execução (ex.: `npm run build && npm run preview:cloud`) com banco de TESTE.
 *
 * Uso: BASE_URL=http://localhost:3000 VICTOR_PASS='...' node e2e/offline.cjs
 *
 * Roteiro: sincroniza → corta a internet → recarrega (abre pelo service worker) → faz pedido,
 * cadastra cliente e faz orçamento para ele → religa a internet → sincroniza → confere números e ausência de duplicidade.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const VICTOR_USER = process.env.VICTOR_USER || 'Victor';
const VICTOR_PASS = process.env.VICTOR_PASS;
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const RUN = Date.now().toString().slice(-5);
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'pt-BR', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };

function cnpj(base8) {
  const b = (base8 + '0001').split('').map(Number);
  const dv = (arr) => { const w = arr.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; const r = arr.reduce((a, n, i) => a + n * w[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(b); const d2 = dv([...b, d1]);
  return [...b, d1, d2].join('');
}
async function shot(page, name) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); console.log('  📸', name); }
const step = (m) => console.log(`\n▶ ${m}`);
const fail = (m) => { throw new Error(m); };

(async () => {
  if (!VICTOR_PASS) throw new Error('Defina VICTOR_PASS');
  const browser = await chromium.launch();
  const ctx = await browser.newContext(PHONE);
  const v = await ctx.newPage();
  v.on('pageerror', (e) => console.log('  ⚠ erro de página:', e.message));

  step('Victor entra com internet');
  await v.goto(`${BASE}/login`);
  await v.getByLabel('Usuário').fill(VICTOR_USER);
  await v.getByLabel('Senha', { exact: true }).fill(VICTOR_PASS);
  await v.getByRole('button', { name: 'Entrar' }).click();
  await v.getByText(/Bem-vindo/).waitFor();

  const clients = await (await v.request.get(`${BASE}/api/seller/clients?onlyActive=true&pageSize=5`)).json();
  const client = clients.items[0] ?? fail('Nenhum cliente ativo para o teste');
  const catalog = await (await v.request.get(`${BASE}/api/seller/catalog`)).json();
  const product = catalog.brands[0]?.products[0] ?? fail('Catálogo vazio');
  const before = (await (await v.request.get(`${BASE}/api/seller/orders?pageSize=1`)).json()).total;
  console.log(`  cliente: ${client.legalName} • produto: ${product.name} • pedidos antes: ${before}`);

  step('Sincroniza (baixa catálogo, clientes e fotos)');
  await v.goto(`${BASE}/vendedor/sincronizar`);
  await v.getByRole('button', { name: /Atualizar produtos e clientes|Enviar agora/ }).click();
  await v.getByText(/Última atualização:/).waitFor({ timeout: 30000 });
  await v.evaluate(() => navigator.serviceWorker.ready);
  await v.reload();
  const controlled = await v.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) fail('Service worker não está controlando a página');
  await shot(v, 'offline-01-sincronizado');

  step('Corta a internet e reabre o sistema');
  await ctx.setOffline(true);
  await v.goto(`${BASE}/vendedor`);
  await v.getByText(/Bem-vindo/).waitFor();
  await v.getByText(/^Sem internet/).first().waitFor();
  await shot(v, 'offline-02-inicio-sem-internet');

  step('Pedido sem internet');
  await v.getByPlaceholder(/Pesquise por razão social/).fill(client.legalName.slice(0, 12));
  await v.getByRole('button', { name: new RegExp(client.legalName.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
  await v.getByText('Cliente selecionado').waitFor();
  await v.getByRole('button', { name: /Realizar novo pedido/ }).click();
  await v.getByPlaceholder(/Buscar produto/).fill(product.sku);
  await v.getByRole('button', { name: `Adicionar ${product.name}` }).first().click();
  await v.getByRole('button', { name: /Revisar/ }).click();
  await v.getByRole('button', { name: /Continuar/ }).click();
  await v.getByText(/Sem internet: valores com os preços/).waitFor();
  await shot(v, 'offline-03-confirmar-sem-internet');
  await v.getByRole('button', { name: 'Confirmar pedido' }).click();
  await v.getByRole('dialog').getByRole('button', { name: 'Confirmar pedido' }).click();
  await v.waitForURL(/\/vendedor\/sincronizar/);
  await v.getByText(/Pedido • /).first().waitFor();

  step('Cadastra cliente novo sem internet e faz orçamento para ele');
  const newName = `Cliente Sem Sinal ${RUN} Ltda`;
  await v.goto(`${BASE}/vendedor/clientes/novo`);
  await v.getByRole('textbox', { name: 'Razão social', exact: true }).fill(newName);
  await v.getByLabel(/^CNPJ/).fill(cnpj('66' + RUN + '1'));
  await v.getByRole('button', { name: /Enviar para aprovação/ }).click();
  await v.getByText('Cliente selecionado').waitFor();
  await v.getByRole('button', { name: /Fazer orçamento/ }).click();
  await v.getByPlaceholder(/Buscar produto/).fill(product.sku);
  await v.getByRole('button', { name: `Adicionar ${product.name}` }).first().click();
  await v.getByRole('button', { name: /Revisar/ }).click();
  await v.getByRole('button', { name: /Continuar/ }).click();
  await v.getByRole('button', { name: /Salvar orçamento/ }).click();
  await v.waitForURL(/\/vendedor\/sincronizar/);
  await v.getByText(/Orçamento • /).first().waitFor();
  const pendingText = await v.getByText(/guardados? no celular/).first().textContent();
  console.log('  faixa:', pendingText);
  await shot(v, 'offline-04-aguardando-envio');

  step('Internet volta → sincroniza');
  await ctx.setOffline(false);
  await v.getByRole('button', { name: /Enviar agora/ }).click({ timeout: 15000 }).catch(() => undefined);
  await v.getByText('Tudo enviado', { exact: true }).waitFor({ timeout: 30000 });
  await v.getByText(/^Pedido PED-/).first().waitFor();
  await v.getByText(/^Orçamento ORC-/).first().waitFor();
  await shot(v, 'offline-05-enviados');

  step('Confere: 1 pedido novo, sem duplicidade, cliente em pendência cadastral');
  await v.getByRole('button', { name: /Atualizar produtos e clientes/ }).click();
  await v.waitForTimeout(2500);
  const after = (await (await v.request.get(`${BASE}/api/seller/orders?pageSize=1`)).json()).total;
  if (after !== before + 1) fail(`Esperado ${before + 1} pedidos, encontrado ${after}`);
  const found = await (await v.request.get(`${BASE}/api/seller/clients?q=${encodeURIComponent(`Sem Sinal ${RUN}`)}`)).json();
  if (found.total !== 1 || found.items[0].status !== 'UNDER_REVIEW') fail('Cliente novo não chegou em pendência cadastral');
  const quotes = await (await v.request.get(`${BASE}/api/seller/quotes?clientId=${found.items[0].id}`)).json();
  if (!quotes.items?.length) fail('Orçamento do cliente novo não chegou');
  console.log(`  pedidos: ${before} → ${after} • cliente ${found.items[0].legalName} (${found.items[0].status}) • orçamentos: ${quotes.items.length}`);

  await browser.close();
  console.log('\n✅ Modo sem internet OK');
})().catch((e) => {
  console.error('\n❌', e.message);
  process.exit(1);
});
