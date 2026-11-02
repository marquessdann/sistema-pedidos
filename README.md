# Della • Sistema de Pedidos de Venda

Sistema web de gestão de **pedidos de venda, orçamentos, clientes, produtos e representantes comerciais** da Della.
Há dois ambientes integrados:

- **Painel administrativo**: clientes, produtos, preços, custos, tributos de referência, vendedores, pedidos, orçamentos, aprovações, estoque, relatórios, auditoria e configurações.
- **Painel do representante** (ex.: Victor Badur): seleção de cliente, catálogo, pedidos, orçamentos, PDFs, compartilhamento e acompanhamento.

Valores são sempre recalculados no servidor a partir do banco de dados, e as permissões são validadas no backend em todas as rotas.

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
| **Autenticação** | Login por sessão (cookie `HttpOnly` + token CSRF), senhas com Argon2id, troca obrigatória de senha no 1º acesso, bloqueio após 5 tentativas erradas (15 min), limite de requisições no login, logout e encerramento de sessões ao bloquear/redefinir senha. |
| **Permissões** | Rotas `/api/admin/*` só para administradores e `/api/seller/*` só para representantes, verificadas no servidor. Cada vendedor vê só os próprios clientes, pedidos e orçamentos (salvo autorização expressa, que dá acesso somente leitura). Custo, margem e tributos internos nunca chegam ao navegador do vendedor (salvo permissão explícita) nem ao PDF. |
| **Dashboard** | Total de clientes, clientes aguardando liberação, produtos ativos, pedidos de hoje, aguardando aprovação, em separação, enviados, concluídos, orçamentos em aberto, valor total, faturado, descontos, vendas por representante, produtos mais vendidos, gráfico diário e pedidos recentes. Filtros por período, cliente, representante e status. |
| **Clientes** | Cadastro completo com máscaras (CNPJ numérico e **alfanumérico**, telefone, CEP), validação de CNPJ, busca de endereço por CEP (ViaCEP), **importação de texto do WhatsApp** com revisão antes de salvar, alerta e bloqueio de duplicidade, 5 status, vendedor responsável ou "liberado para todos", registro de quem criou/alterou e quando. |
| **Produtos** | SKU, nome, marca, categoria, descrição, imagem principal e adicionais (validação real do tipo do arquivo), unidade, custo, tributo de referência, preço de venda, margem e markup calculados, estoque, status e observações internas. Duplicar, ativar/inativar, pesquisa por nome/SKU/marca/categoria, navegação por marca e histórico de preços. |
| **Marcas e categorias** | Cadastro e ordenação; o catálogo do vendedor é organizado como **Marca → Produtos**. |
| **Vendedores** | Victor Badur pré-cadastrado; nome, CPF, telefones, usuário, senha, status, data de cadastro, comissão, desconto máximo, observações e permissões (pedidos de terceiros, custo, total de compras, contato financeiro). Bloquear/ativar e redefinir senha. |
| **Pedidos** | Assistente em 5 etapas com progresso (Dados → Marcas e produtos → Revisão → Resumo financeiro → Confirmação), resumo de valores fixo na tela, soma de quantidade ao repetir o SKU, rascunho, confirmação com diálogo, numeração única (`PED-AAAA-000001`), proteção contra duplicação (chave de idempotência), cópia dos dados comerciais em cada item, duplicação e histórico. |
| **Descontos e aprovações** | "Desconto do vendedor (%)" recalculado na hora; desconto por item (configurável); limite individual verificado por item, geral e combinado; acima do limite o pedido não é confirmado e o vendedor pode **solicitar aprovação** com justificativa; o administrador aprova ou reprova, e tudo fica registrado. |
| **Orçamentos** | Mesmo catálogo e mesmo motor de cálculo; validade; 7 status; editar enquanto válido; duplicar; PDF identificado como proposta; **"Transformar em pedido"** com revisão das condições, aviso de diferença de preço, vínculo com o orçamento e bloqueio de conversão duplicada (inclusive simultânea). Nova conversão só por ação administrativa justificada, depois de cancelar o pedido anterior. |
| **Processo do pedido** | Linha do tempo com as 9 etapas, além de Cancelado e Reprovado; histórico imutável (status anterior/novo, data e hora, usuário, observação); transições configuráveis; pedido concluído ou cancelado só reabre por ação administrativa com justificativa. |
| **PDF** | Geração real (pdfkit), com logotipo (ou nome estilizado), dados da empresa, cliente, contato comercial do vendedor, itens, descontos, acréscimos, total, condições, entrega, validade e observações. Arquivos versionados, armazenados com hash SHA-256 e vinculados ao registro. Visualizar, baixar, gerar novamente, compartilhar (nativo do celular) e WhatsApp com mensagem pronta. O PDF **nunca** contém custo, margem, lucro, tributos internos ou CPF do vendedor. |
| **E-mail** | Envio do PDF por SMTP, pronto para uso assim que as variáveis forem configuradas. Sem SMTP, o sistema informa claramente que nada foi enviado. |
| **Estoque** | Desabilitado por padrão ("pendente de integração"). Quando habilitado: saldo por SKU, reserva na aprovação ou na separação e baixa no envio (configurável), devolução e liberação no cancelamento, ajustes com justificativa e responsável, sem baixa duplicada. Orçamentos nunca movimentam estoque. |
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
   ├─ PDF (pdfkit) ─ arquivos em STORAGE_DIR
   └─ Prisma ORM
        ▼
 PostgreSQL (migrações versionadas, CHECKs, gatilhos de imutabilidade)
```

- **Frontend**: React 19, TypeScript, Tailwind CSS 4, TanStack Query, React Router, ícones Lucide e uma biblioteca própria de componentes (`web/src/components/ui`) com identidade azul-marinho e dourado.
- **Backend**: Fastify 5, Zod (validação com mensagens em português), Prisma 6, Argon2id, pdfkit e nodemailer (opcional).
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
| `DATABASE_URL` | Conexão com o PostgreSQL. |
| `TEST_DATABASE_URL` | Banco **exclusivo** para testes; o nome precisa conter "test", e ele é limpo a cada teste. |
| `PORT`, `HOST` | Porta e endereço da API (padrão 3333). |
| `APP_URL` | URL pública do sistema. |
| `COOKIE_SECURE` | `true` em produção (exige HTTPS). Em `NODE_ENV=production` o cookie já é seguro. |
| `SESSION_TTL_HOURS` | Duração da sessão (padrão 12h). |
| `STORAGE_DIR` | Pasta das imagens, do logotipo e dos PDFs. **Inclua no backup.** |
| `ADMIN_USERNAME`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Primeiro administrador, criado pelo seed. A senha precisa ter 10+ caracteres com letras e números. |
| `SEED_VICTOR_PASSWORD` | Senha inicial do Victor. Vazio em desenvolvimento = `1234` com troca obrigatória. **Obrigatória e forte em produção.** |
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
| Administrador | `ADMIN_USERNAME` do `.env` (padrão `admin`) | `ADMIN_PASSWORD` do `.env` |
| Victor Badur (representante) | `victor` | `1234` em desenvolvimento, com **troca obrigatória no 1º acesso** |

- Entre em `/login`. O administrador vai para `/admin` e o vendedor para `/vendedor`.
- A senha `1234` existe só para desenvolvimento ou implantação controlada; ela é guardada como hash Argon2id. Em produção o seed recusa senha fraca e exige `SEED_VICTOR_PASSWORD`.
- O cadastro do Victor sai com **limite de desconto inicial de 5%** e sem CPF e telefones: **complete em Vendedores** (valores editáveis).

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
2. Etapa 1: condição de pagamento, entrega e observações. Etapa 2: pesquise por nome/SKU ou navegue por marca, informe a quantidade e clique em **Adicionar ao pedido**. Etapa 3: revise quantidades e descontos por item.
3. Etapa 4: **Desconto do vendedor (%)**. Acima do limite, informe a justificativa.
4. Etapa 5: confira o resumo (validado pelo servidor) → **Confirmar pedido** (ou **Solicitar aprovação**).
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
- `server/test`: login de admin e vendedor, troca obrigatória de senha, bloqueio por tentativas, CSRF, bloqueio de acesso indevido, cadastro de cliente, validação de CNPJ, duplicidade, cadastro de produto, pesquisa por SKU, catálogo sem dados internos, vários produtos, subtotal, desconto percentual, limite de desconto, aprovação e reprovação, total final, numeração simultânea, idempotência, pedido, orçamento, conversão, conversão duplicada (inclusive simultânea), PDF (geração, download, conteúdo sem custo/CPF, falha sem duplicação), consulta por período e filtros, histórico de status, permissões entre vendedores, estoque, relatórios e CSV. **65 testes.**
- Os testes de integração usam `TEST_DATABASE_URL`, aplicam as migrações automaticamente e limpam esse banco a cada teste.

**Teste de aceite no navegador** (com o servidor rodando e o seed aplicado):

```bash
npm run build && npm start &
ADMIN_PASS='sua-senha-admin' VICTOR_PASS='1234' node e2e/acceptance.cjs
```

O roteiro cobre o critério de aceite completo (cadastro de cliente e produtos, login do Victor, pedido com vários produtos e desconto, confirmação, PDF, andamento, orçamento convertido sem duplicação e telas no celular) e grava screenshots em `e2e/screenshots/`.

## 12. Segurança

- Senhas com Argon2id (parâmetros OWASP); nunca em texto puro nem nos logs (cookies e tokens são mascarados no log).
- Sessão em banco, com token aleatório guardado só como hash SHA-256; cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
- CSRF: toda requisição que altera dados exige o cabeçalho `X-CSRF-Token` ligado à sessão.
- Limite de tentativas no login (por IP) e bloqueio temporário do usuário após 5 erros.
- Autorização no servidor em todas as rotas. O catálogo do vendedor usa seleção explícita de colunas, então o custo nem é lido do banco.
- Proteção contra SQL injection via Prisma e consultas parametrizadas; Zod valida todas as entradas.
- Cabeçalhos de segurança (Helmet/CSP), `Cache-Control: no-store` na API e uploads validados pelo conteúdo real do arquivo (PNG/JPG/WEBP, 5 MB), com nomes gerados pelo servidor.
- CSV exportado com proteção contra injeção de fórmulas.

## 13. Backup e recuperação

Faça backup do **banco** e da pasta **`STORAGE_DIR`** (imagens, logotipo e PDFs).

```bash
# backup diário (exemplo via cron)
pg_dump --format=custom --file=della-$(date +%F).dump "$DATABASE_URL"
tar czf della-storage-$(date +%F).tgz storage/

# recuperação
createdb -O della della_restaurado
pg_restore --no-owner --dbname=postgresql://della:SENHA@localhost:5432/della_restaurado della-AAAA-MM-DD.dump
tar xzf della-storage-AAAA-MM-DD.tgz
```

Guarde cópias fora do servidor e teste a restauração periodicamente. Os PDFs podem ser regenerados a partir dos dados, mas as imagens dos produtos não.

## 14. Implantação com Docker

```bash
# no .env, defina também POSTGRES_PASSWORD, ADMIN_PASSWORD e SEED_VICTOR_PASSWORD
docker compose up -d --build
```

Na inicialização, o container aplica as migrações, roda o seed (idempotente) e sobe a aplicação na porta 3333. Coloque um proxy HTTPS na frente e defina `COOKIE_SECURE=true`.

## 15. Pendências e configurações manuais

- **Credenciais**: definir `ADMIN_PASSWORD` e, em produção, `SEED_VICTOR_PASSWORD` forte. Completar CPF, telefones e comissão do Victor.
- **Dados da empresa e logotipo** para o PDF: Configurações → Empresa e documentos. Não havia logotipo da Della no repositório; até o envio, o PDF usa o nome "DELLA" estilizado.
- **Tributos**: cadastre os percentuais validados pelo contador em Configurações → Tributos e acréscimos. Nenhuma alíquota vem pré-configurada.
- **Condições de pagamento**: o seed cria sugestões (À vista, 28, 30/60, 30/60/90 dias); revise.
- **E-mail**: configurar `SMTP_HOST` e as demais variáveis SMTP. Sem isso, o botão de e-mail não aparece.
- **WhatsApp**: hoje o sistema abre o WhatsApp com a mensagem pronta (e usa o compartilhamento nativo no celular); o envio automático **não** acontece. Para automatizar, é preciso contratar a WhatsApp Business Platform (ou um provedor oficial) e implementar o envio com `WHATSAPP_API_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID`.
- **Estoque**: desabilitado até os saldos serem conferidos ou integrados ao sistema de estoque da empresa.
- **HTTPS**: obrigatório em produção (proxy reverso).
- **Docker**: o `Dockerfile` e o `docker-compose.yml` foram escritos mas não puderam ser construídos no ambiente de desenvolvimento usado (sem daemon Docker). Valide o build na primeira implantação.
