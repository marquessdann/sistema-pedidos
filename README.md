# Della • Sistema de Pedidos de Venda

Sistema web de gestão de **pedidos de venda, orçamentos, clientes, produtos e representantes comerciais** da Della.
Há dois ambientes integrados:

- **Painel administrativo**: clientes, produtos, preços, custos, tributos de referência, vendedores, pedidos, orçamentos, aprovações, estoque, relatórios, auditoria e configurações.
- **Painel do representante** (ex.: Victor Badur): seleção de cliente, catálogo, pedidos, orçamentos, PDFs, compartilhamento e acompanhamento.

Valores são sempre recalculados no servidor a partir do banco de dados, e as permissões são validadas no backend em todas as rotas.

**Roda 100% na nuvem (Vercel + PostgreSQL)** e é pensado primeiro para **celular e tablet**: abre direto no
navegador (Safari/Chrome), sem instalar nada. **Para publicar, siga [docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md).**

---

## Sumário

1. [O que foi implementado](#1-o-que-foi-implementado)
2. [Arquitetura](#2-arquitetura)
3. [Estrutura de pastas](#3-estrutura-de-pastas)
4. [Instalação](#4-instalação)
5. [Variáveis de ambiente](#5-variáveis-de-ambiente)
6. [Banco de dados: criar e migrar](#6-banco-de-dados-criar-e-migrar)
7. [Iniciar o sistema](#7-iniciar-o-sistema)
8. [Acessos: administrador e vendedor](#8-acessos-administrador-e-vendedor)
9. [Como usar](#9-como-usar)
10. [Regras de cálculo](#10-regras-de-cálculo)
11. [Testes](#11-testes)
12. [Segurança](#12-segurança)
13. [Backup e recuperação](#13-backup-e-recuperação)
14. [Implantação com Docker](#14-implantação-com-docker)
15. [Pendências e configurações manuais](#15-pendências-e-configurações-manuais)

---

## 1. O que foi implementado

| Área | Funcionalidades |
|---|---|
| **Celular e tablet** | Menu inferior com os atalhos principais, campos e botões grandes para toque (fonte de 16px, sem zoom automático no iPhone), listas em cartões, pedido em 3 etapas com carrinho flutuante, atalhos de desconto (1% a 5%) e fotos reduzidas no próprio aparelho antes do envio. |
| **Autenticação** | Login por sessão (cookie `HttpOnly` + token CSRF), senhas com hash scrypt, troca obrigatória de senha no 1º acesso, bloqueio após 5 tentativas erradas (15 min), limite de requisições no login, logout e encerramento de sessões ao bloquear/redefinir senha. |
| **Permissões** | Rotas `/api/admin/*` só para administradores e `/api/seller/*` só para representantes, verificadas no servidor. Cada vendedor vê só os próprios clientes, pedidos e orçamentos (salvo autorização expressa, que dá acesso somente leitura). Custo, margem e tributos internos nunca chegam ao navegador do vendedor (salvo permissão explícita) nem ao PDF. |
| **Dashboard** | Total de clientes, clientes aguardando liberação, produtos ativos, pedidos de hoje, aguardando aprovação, em separação, enviados, concluídos, orçamentos em aberto, valor total, faturado, descontos, vendas por representante, produtos mais vendidos, gráfico diário e pedidos recentes. Filtros por período, cliente, representante e status. |
| **Clientes** | Cadastro completo com máscaras (CNPJ numérico e **alfanumérico**, telefone, CEP), validação de CNPJ, busca de endereço por CEP (ViaCEP), **importação de texto do WhatsApp** com revisão antes de salvar, alerta e bloqueio de duplicidade, 5 status, vendedor responsável ou "liberado para todos", registro de quem criou/alterou e quando. |
| **Produtos** | SKU, nome, marca, categoria, descrição, imagem principal e adicionais (validação real do tipo do arquivo), unidade, **unidades por caixa** (o vendedor escolhe vender por **CX** ou **UN**; preço da caixa = preço × unidades), custo, tributo de referência, preço de venda, margem e markup calculados, estoque, status e observações internas. Duplicar, ativar/inativar, pesquisa por nome/SKU/marca/categoria, navegação por marca e histórico de preços. |
| **Marcas e categorias** | Cadastro e ordenação; o catálogo do vendedor é organizado como **Marca → Produtos**. |
| **Vendedores** | Victor Badur pré-cadastrado; nome, CPF, telefones, usuário, senha, status, data de cadastro, comissão, desconto máximo, observações e permissões (pedidos de terceiros, custo, total de compras, contato financeiro). Bloquear/ativar e redefinir senha. |
| **Pedidos** | Assistente em 3 etapas (Produtos → Revisão e condições → Confirmar), total sempre visível na barra inferior, escolha de CX ou UN em cada item, soma automática de quantidade ao repetir o mesmo produto e unidade, rascunho, confirmação com diálogo, numeração única (`PED-AAAA-000001`), proteção contra duplicação (chave de idempotência), cópia dos dados comerciais em cada item, duplicação e histórico. |
| **Descontos e aprovações** | "Desconto do vendedor (%)" recalculado na hora; desconto por item (configurável); limite individual verificado por item, geral e combinado; acima do limite o pedido não é confirmado e o vendedor pode **solicitar aprovação** com justificativa; o administrador aprova ou reprova, e tudo fica registrado. |
| **Orçamentos** | Mesmo catálogo e mesmo motor de cálculo; validade; 7 status; editar enquanto válido; duplicar; PDF identificado como proposta; **"Transformar em pedido"** com revisão das condições, aviso de diferença de preço, vínculo com o orçamento e bloqueio de conversão duplicada (inclusive simultânea). Nova conversão só por ação administrativa justificada, depois de cancelar o pedido anterior. |
| **Processo do pedido** | Linha do tempo com as 9 etapas, além de Cancelado e Reprovado; histórico imutável (status anterior/novo, data e hora, usuário, observação); transições configuráveis; pedido concluído ou cancelado só reabre por ação administrativa com justificativa. |
| **PDF** | Geração real (pdfkit), com logotipo (ou nome estilizado), dados da empresa, cliente, contato comercial do vendedor, itens, descontos, acréscimos, total, condições, entrega, validade e observações. Arquivos versionados, armazenados com hash SHA-256 e vinculados ao registro. Visualizar, baixar, gerar novamente, compartilhar (nativo do celular) e WhatsApp com mensagem pronta. O PDF **nunca** contém custo, margem, lucro, tributos internos ou CPF do vendedor. |
| **E-mail** | Envio do PDF por SMTP, pronto para uso assim que as variáveis forem configuradas. Sem SMTP, o sistema informa claramente que nada foi enviado. |
| **Estoque** | Desabilitado por padrão ("pendente de integração"). Quando habilitado: saldo por SKU em unidades (caixas são convertidas), reserva na aprovação ou na separação e baixa no envio (configurável), devolução e liberação no cancelamento, ajustes com justificativa e responsável, sem baixa duplicada. Orçamentos nunca movimentam estoque. |
| **Perfis** | **Administrador** (acesso total), **Gestor** e **Vendedor**. O gestor (ex.: Vinicius) enxerga só os vendedores que acompanha e só faz o que o administrador marcar: ver vendas, calculadora de comissão, liberar produtos, liberar clientes, aprovar descontos e atualizar andamento. Ele nunca vê custo, margem, configurações nem auditoria. Tudo é validado no servidor (`/api/manager/*`). |
| **Comissões** | Calculadora por período e vendedor: base = valor dos produtos após descontos (sem frete e sem acréscimos) × % de comissão do cadastro, com simulação de outra %, opção "somente faturados" e exportação CSV. |
| **Relatórios** | Pedidos por período, vendas por vendedor e por cliente, produtos mais vendidos e quantidades por SKU, orçamentos gerados e convertidos, taxa de conversão, descontos concedidos, pedidos pendentes e cancelados, e resumo bruto x líquido (criados x aprovados x **faturados**). Exportação em CSV compatível com Excel. |
| **Auditoria** | Log de logins, clientes, produtos, preços, descontos, aprovações, status, conversões, cancelamentos, estoque, documentos e configurações. O log é **imutável no banco** (um gatilho impede UPDATE e DELETE). |
| **Configurações** | Dados da empresa e logotipo do PDF, condições gerais do orçamento, fuso horário, validade padrão, prefixos de numeração, desconto por item, frete, política de preço na conversão, política de estoque, condições de pagamento, tributos e acréscimos, fluxo de status e administradores adicionais. |

## 2. Arquitetura

```
 Navegador (React + Vite + Tailwind)
        │  HTTPS, cookie de sessão HttpOnly + cabeçalho X-CSRF-Token
        ▼
 API REST (Node.js + Fastify + TypeScript + Zod)
   ├─ autenticação/sessões ─ permissões por papel (ADMIN / SELLER)
   ├─ motor de cálculo (pacote @della/shared, em centavos e pontos-base)
   ├─ PDF (pdfkit) ─ arquivos guardados no próprio PostgreSQL
   └─ Prisma ORM
        ▼
 PostgreSQL (migrações versionadas, CHECKs, gatilhos de imutabilidade)
```

- **Frontend**: React 19, TypeScript, Tailwind CSS 4, TanStack Query, React Router, ícones Lucide e uma biblioteca própria de componentes (`web/src/components/ui`) com identidade azul-marinho e dourado.
- **Backend**: Fastify 5, Zod (validação com mensagens em português), Prisma 6, scrypt (nativo do Node), pdfkit e nodemailer (opcional).
- **Hospedagem**: no Vercel, a API roda como função serverless (`api/index.mjs` → `server/src/vercel.ts`) e o site é servido como arquivos estáticos. Imagens, logotipo e PDFs ficam na tabela `stored_files` do PostgreSQL (não há disco persistente em serverless). `npm run preview:cloud` simula esse ambiente localmente.
- **Compartilhado**: `shared/` contém o motor de cálculo, as validações de CNPJ/CPF, as máscaras, os status e o leitor de texto do WhatsApp. O mesmo código roda no navegador (para mostrar os valores na hora) e no servidor (que recalcula e decide).
- **Dinheiro**: inteiros em **centavos**. **Percentuais**: inteiros em **pontos-base** (1% = 100). Arredondamento meio-para-cima com `BigInt`; o desconto geral é rateado entre os itens fechando ao centavo.
- **Concorrência**: numeração por sequência atômica (`INSERT … ON CONFLICT … RETURNING`), chave de idempotência única por pedido, `SELECT … FOR UPDATE` na conversão de orçamento e controle otimista (`version`) nas edições e mudanças de status.

## 3. Estrutura de pastas

```
.
├── shared/                  # código comum (cálculo, validações, status)
│   ├── src/pricing.ts       # motor de cálculo + verificação de limite de desconto
│   ├── src/money.ts         # centavos, bps, formatação R$
│   ├── src/documents.ts     # CNPJ (inclusive alfanumérico), CPF, máscaras, link WhatsApp
│   ├── src/clientParser.ts  # importação de dados por texto (WhatsApp)
│   └── test/                # testes unitários
├── server/
│   ├── prisma/
│   │   ├── schema.prisma    # modelo relacional
│   │   ├── migrations/      # migrações versionadas (inclui CHECKs e gatilhos)
│   │   ├── seed.ts          # configuração inicial, admin e Victor Badur
│   │   └── demo.ts          # dados de demonstração FICTÍCIOS (prefixo DEMO)
│   ├── src/
│   │   ├── app.ts / server.ts
│   │   ├── lib/             # auth, auditoria, numeração, armazenamento, validação
│   │   └── modules/
│   │       ├── auth/        # login, logout, troca de senha
│   │       ├── admin/       # clientes, vendedores, catálogo, configurações, pedidos, relatórios, estoque, auditoria
│   │       ├── seller/      # rotas do representante (sempre filtradas pelo vendedor da sessão)
│   │       ├── commercial/  # serviços: preços, pedidos, orçamentos, aprovações, estoque
│   │       └── documents/   # PDF, arquivos e e-mail
│   └── test/                # testes de integração (API + banco)
├── web/
│   └── src/
│       ├── components/      # ui (design system), layout, PDF, linha do tempo
│       ├── pages/admin/     # painel administrativo
│       ├── pages/seller/    # painel do representante (assistente de pedido em DocWizard.tsx)
│       └── lib/             # cliente da API, autenticação, hooks
├── e2e/acceptance.cjs       # teste de aceite no navegador (Playwright)
├── Dockerfile / docker-compose.yml
└── .env.example
```

## 4. Instalação

Requisitos: **Node.js 20+** (recomendado 22) e **PostgreSQL 14+** (testado no 16).

```bash
npm install
```

## 5. Variáveis de ambiente

```bash
cp .env.example .env
```

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Conexão com o PostgreSQL (na nuvem: URL com pooler). |
| `DIRECT_URL` | Conexão direta, usada pelas migrações (localmente pode ser igual à `DATABASE_URL`; no Vercel é preenchida a partir de `DATABASE_URL_UNPOOLED`). |
| `TEST_DATABASE_URL` | Banco **exclusivo** para testes; o nome precisa conter "test", e ele é limpo a cada teste. |
| `PORT`, `HOST` | Porta e endereço da API (padrão 3333). |
| `APP_URL` | URL pública do sistema. |
| `COOKIE_SECURE` | `true` em produção (exige HTTPS). Em `NODE_ENV=production` o cookie já é seguro. |
| `SESSION_TTL_HOURS` | Duração da sessão (padrão 12h). |
| `ADMIN_USERNAME`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Primeiro administrador, criado pelo seed. A senha precisa ter 10+ caracteres com letras e números. |
| `SEED_VICTOR_PASSWORD` | Senha do Victor (10+ caracteres com letras e números). Vazio em desenvolvimento = `1234` com troca obrigatória. **Obrigatória em produção.** |
| `SMTP_*` | Envio de PDF por e-mail (opcional). |
| `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Reservadas para a integração futura com a WhatsApp Business Platform. |

## 6. Banco de dados: criar e migrar

```bash
# crie o usuário e o banco (exemplo)
sudo -u postgres psql -c "CREATE USER della WITH PASSWORD 'della' CREATEDB;"
sudo -u postgres createdb -O della della
sudo -u postgres createdb -O della della_test   # para os testes

npm run db:deploy     # aplica as migrações (produção e primeira instalação)
npm run db:seed       # configurações padrão, administrador (do .env) e Victor Badur
npm run db:demo       # OPCIONAL: marcas, produtos e clientes fictícios (prefixo DEMO)
```

Em desenvolvimento, para criar novas migrações a partir de mudanças no `schema.prisma`: `npm run db:migrate`.

Para criar outro administrador, ou redefinir a senha de um, com segurança pela linha de comando:

```bash
ADMIN_USERNAME=maria ADMIN_NAME="Maria" ADMIN_PASSWORD='SenhaForte2026' npm run create-admin
```

## 7. Iniciar o sistema

**Desenvolvimento** (API com recarga automática + Vite):

```bash
npm run dev
# frontend: http://localhost:5173  (encaminha /api para a porta 3333)
```

**Produção** (a API também serve o frontend compilado):

```bash
npm run build
npm start          # http://localhost:3333
```

Use um proxy reverso com HTTPS (Nginx, Caddy etc.) na frente da aplicação.

## 8. Acessos: administrador e vendedor

| Perfil | Usuário | Senha |
|---|---|---|
| Administrador | `daniel` (`ADMIN_USERNAME`) | `ADMIN_PASSWORD` (variável de ambiente) |
| Victor Badur (representante) | `victor` | `SEED_VICTOR_PASSWORD` (variável de ambiente) |
| Vinicius (gestor) | `vinicius` | `VINICIUS_PASSWORD` (variável de ambiente) |

- Entre em `/login`. O administrador vai para `/admin` e o vendedor para `/vendedor`.
- O usuário não diferencia maiúsculas de minúsculas (`Victor` = `victor`). As senhas nunca ficam no código; o banco guarda só o hash.
- O Victor é criado com **comissão de 10%** e **desconto máximo de 5%** (no pedido aparecem atalhos de 1% a 5%). CPF e telefones: **complete em Vendedores**.

## 9. Como usar

**Cadastrar um cliente** (Admin → Clientes → Novo cliente)
1. Opcional: **Importar texto do WhatsApp**. Cole a mensagem do vendedor, confira os campos identificados e clique em "Preencher formulário".
2. Revise os dados. O CNPJ é validado e possíveis duplicidades são alertadas.
3. Defina o **vendedor responsável** e o status **Ativo**, e salve. A partir daí o cliente aparece para o vendedor.

**Cadastrar produtos** (Admin → Marcas e categorias → Produtos → Novo produto)
1. Crie as marcas e categorias.
2. Informe SKU, nome, marca, unidade, custo, tributo de referência e preço de venda. A margem é calculada na tela.
3. Salve e adicione as imagens (a primeira vira a principal).

**Gerar um pedido e o PDF** (como vendedor)
1. **Início** → pesquise e selecione o cliente → **Realizar novo pedido**.
2. **Produtos**: pesquise por nome/código ou toque na marca; escolha **UN** ou **CX**, a quantidade e toque em **Adicionar**.
3. **Revisão e condições**: ajuste quantidades, toque no desconto (Sem, 1% … 5% ou Outro), condição de pagamento, entrega e observações. Acima do limite, informe o motivo.
4. **Confirmar**: confira o resumo (validado pelo servidor) → **Confirmar pedido** (ou **Enviar para aprovação**).
5. Na tela do pedido: **Gerar PDF** → Visualizar, Baixar, Compartilhar ou **WhatsApp** (abre a conversa com a mensagem pronta; o PDF é anexado manualmente).

**Orçamento → pedido**: Início → **Fazer orçamento** → mesmas etapas → **Salvar e gerar PDF**. Quando o cliente aprovar, abra o orçamento e clique em **Transformar em pedido**.

**Andamento**: o administrador altera o status em Pedidos → (pedido) → **Alterar status**. O vendedor acompanha em **Processo do pedido**.

## 10. Regras de cálculo

Ordem fixa, com cada base bem definida e nada aplicado duas vezes:

1. Bruto da linha = preço autorizado × quantidade
2. − desconto do item (% sobre o bruto da linha)
3. Subtotal = soma das linhas líquidas
4. − desconto geral do vendedor (% sobre o subtotal), rateado entre as linhas
5. \+ **acréscimos** configurados (regras do tipo "Acréscimo"), cada um com base no valor **bruto** ou **líquido** dos itens a que se aplica (todos, uma marca, uma categoria ou um produto)
6. \+ frete
7. = **Total**

Regras do tipo **"Tributo estimado (interno)"** e o tributo de referência do produto **não entram no total**: servem só para estimar a margem, que aparece apenas para o administrador. Os percentuais são referências comerciais informadas pela empresa e validadas pelo contador; o sistema não inventa alíquotas. Cada pedido guarda a **memória de cálculo**, visível ao administrador.

O limite de desconto do vendedor vale para cada item, para o desconto geral **e** para o desconto efetivo combinado.

## 11. Testes

```bash
npm test                                   # unitários (shared) + integração (server)
```

- `shared/test`: cálculo (subtotal, descontos, rateio, acréscimos, limites, arredondamento), CNPJ/CPF, máscaras, importação de texto e datas. **19 testes.**
- `server/test`: login de admin e vendedor, troca obrigatória de senha, bloqueio por tentativas, CSRF, bloqueio de acesso indevido, cadastro de cliente, validação de CNPJ, duplicidade, cadastro de produto, pesquisa por SKU, catálogo sem dados internos, vários produtos, subtotal, desconto percentual, limite de desconto, aprovação e reprovação, total final, numeração simultânea, idempotência, pedido, orçamento, conversão, conversão duplicada (inclusive simultânea), PDF (geração, download, conteúdo sem custo/CPF, falha sem duplicação), consulta por período e filtros, histórico de status, permissões entre vendedores, estoque, relatórios e CSV. 
- Os testes de integração usam `TEST_DATABASE_URL`, aplicam as migrações automaticamente e limpam esse banco a cada teste. Hoje são **71 testes de integração** (incluindo venda por caixa e arquivos no banco) e **20 unitários**.

**Teste de aceite no navegador** (simulando celular e tablet, contra um banco de TESTE com o seed aplicado):

```bash
npm run build && npm run preview:cloud &      # simula o Vercel em http://localhost:3000
ADMIN_PASS='senha-do-daniel' VICTOR_PASS='senha-do-victor' node e2e/acceptance.cjs
```

O roteiro faz o fluxo completo: Daniel no tablet cadastra cliente e produtos; Victor no celular faz um pedido com caixas e unidades e 5% de desconto, confirma e gera o PDF; Daniel aprova; Victor acompanha o andamento; e um orçamento é convertido em pedido. Os registros criados levam o nome "Teste automático", e os screenshots vão para `e2e/screenshots/`.

## 12. Segurança

- Senhas com scrypt (N=2^15, parâmetros OWASP); nunca em texto puro nem nos logs (cookies e tokens são mascarados no log).
- Sessão em banco, com token aleatório guardado só como hash SHA-256; cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
- CSRF: toda requisição que altera dados exige o cabeçalho `X-CSRF-Token` ligado à sessão.
- Limite de tentativas no login (por IP) e bloqueio temporário do usuário após 5 erros.
- Autorização no servidor em todas as rotas. O catálogo do vendedor usa seleção explícita de colunas, então o custo nem é lido do banco.
- Proteção contra SQL injection via Prisma e consultas parametrizadas; Zod valida todas as entradas.
- Cabeçalhos de segurança (Helmet/CSP), `Cache-Control: no-store` na API e uploads validados pelo conteúdo real do arquivo (PNG/JPG/WEBP, 5 MB), com nomes gerados pelo servidor.
- CSV exportado com proteção contra injeção de fórmulas.

## 13. Backup e recuperação

Tudo fica no banco (inclusive imagens, logotipo e PDFs), então um único `pg_dump` é o backup completo.
O Neon também mantém histórico de restauração automático (consulte o plano contratado).

```bash
# backup (use a conexão direta / DATABASE_URL_UNPOOLED)
pg_dump --format=custom --file=della-$(date +%F).dump "$DIRECT_URL"

# recuperação em um banco novo
pg_restore --no-owner --dbname="postgresql://usuario:senha@host/banco_novo" della-AAAA-MM-DD.dump
```

Guarde cópias fora do provedor e teste a restauração periodicamente.

## 14. Implantação com Docker

```bash
# no .env, defina também POSTGRES_PASSWORD, ADMIN_PASSWORD e SEED_VICTOR_PASSWORD
docker compose up -d --build
```

Na inicialização, o container aplica as migrações, roda o seed (idempotente) e sobe a aplicação na porta 3333. Coloque um proxy HTTPS na frente e defina `COOKIE_SECURE=true`.

## 15. Pendências e configurações manuais

- **Publicação**: seguir [docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md) (criar o projeto no Vercel, conectar o banco Neon e cadastrar as senhas nas variáveis de ambiente).
- **Cadastro do Victor**: completar CPF e telefones em Vendedores.
- **Dados da empresa e logotipo** para o PDF: Configurações → Empresa e documentos. Não havia logotipo da Della no repositório; até o envio, o PDF usa o nome "DELLA" estilizado.
- **Tributos**: cadastre os percentuais validados pelo contador em Configurações → Tributos e acréscimos. Nenhuma alíquota vem pré-configurada.
- **Condições de pagamento**: o seed cria sugestões (À vista, 28, 30/60, 30/60/90 dias); revise.
- **E-mail**: configurar `SMTP_HOST` e as demais variáveis SMTP. Sem isso, o botão de e-mail não aparece.
- **WhatsApp**: hoje o sistema abre o WhatsApp com a mensagem pronta (e usa o compartilhamento nativo no celular); o envio automático **não** acontece. Para automatizar, é preciso contratar a WhatsApp Business Platform (ou um provedor oficial) e implementar o envio com `WHATSAPP_API_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID`.
- **Estoque**: desabilitado até os saldos serem conferidos ou integrados ao sistema de estoque da empresa.
- **HTTPS**: obrigatório em produção (proxy reverso).
- **Docker** (alternativa ao Vercel): o `Dockerfile` e o `docker-compose.yml` foram escritos mas não puderam ser construídos no ambiente de desenvolvimento usado (sem daemon Docker).
