# Publicar no Vercel (acesso pelo navegador do celular)

O sistema roda inteiro na nuvem: o site e a API ficam no **Vercel**, e o banco de dados é um
**PostgreSQL** gerenciado (Neon, criado pelo próprio painel do Vercel). Imagens, logotipo e PDFs
ficam guardados no banco. Depois de publicado, basta abrir o link no Safari ou no Chrome
do celular, do tablet ou do computador. Não é preciso instalar nada.

Tempo estimado: 10 minutos. Todos os passos são feitos no navegador.

## 1. Criar o projeto no Vercel

1. Entre em <https://vercel.com> com a sua conta (dá para entrar com o GitHub).
2. Clique em **Add New… → Project**.
3. Em **Import Git Repository**, escolha `marquessdann/sistema-pedidos` (autorize o acesso ao GitHub se for pedido).
4. Em **Branch**, use a branch publicada (`claude/sistema-pedidos-della`) ou a `main`, se ela já tiver recebido o código.
5. **Framework Preset**: deixe **Other**. Não altere os comandos: o arquivo `vercel.json` já define tudo.
6. **Ainda não clique em Deploy.** Primeiro abra **Environment Variables** e cadastre as variáveis do passo 3.

## 2. Criar o banco de dados

1. No projeto do Vercel, abra a aba **Storage → Create Database → Neon (Serverless Postgres)**.
2. Escolha a região **São Paulo (sa-east-1)**. A API do sistema já está configurada para rodar em São Paulo (`gru1`); banco e API na mesma cidade deixam tudo mais rápido.
3. Conecte o banco ao projeto, marcando os ambientes **Production** e **Preview**.
   O Vercel cria sozinho as variáveis `DATABASE_URL` e `DATABASE_URL_UNPOOLED`. O sistema usa
   a primeira para funcionar e a segunda para criar as tabelas.

> Se preferir criar o banco antes do projeto, crie-o em **Storage** e conecte-o ao projeto depois.
> Também funciona com Supabase: informe `DATABASE_URL` (pooler, porta 6543) e `DIRECT_URL` (porta 5432).

## 3. Variáveis de ambiente

Em **Settings → Environment Variables** (ambiente **Production**):

| Nome | Valor |
|---|---|
| `ADMIN_USERNAME` | `daniel` |
| `ADMIN_NAME` | `Daniel` |
| `ADMIN_PASSWORD` | a senha do administrador (mínimo 10 caracteres, com letras e números) |
| `SEED_VICTOR_PASSWORD` | a senha do Victor (mínimo 10 caracteres, com letras e números) |
| `VINICIUS_PASSWORD` | a senha do Vinicius, gestor (mínimo 6 caracteres; recomendado 10+ com letras e números) |

As senhas **não ficam no código**: só nessas variáveis. O banco guarda apenas o hash (scrypt).
Esses valores são usados uma única vez, no primeiro deploy, para criar os usuários. Para trocar uma
senha depois, use "Minha conta" no sistema (ou "Redefinir senha" do vendedor, no painel do administrador).

Opcional: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_FROM` habilitam o envio do PDF por e-mail.

## 4. Publicar

Clique em **Deploy** (ou, em **Deployments**, em **Redeploy**). O build faz tudo sozinho:

1. instala as dependências;
2. cria ou atualiza as tabelas do banco (migrações);
3. compila o site e a API;
4. cria as configurações iniciais, o administrador **daniel**, o representante **victor**
   (comissão de 10% e desconto máximo de 5%) e o gestor **vinicius** (acompanha o Victor),
   somente se ainda não existirem.

Ao terminar, o Vercel mostra o endereço do sistema, por exemplo `https://sistema-pedidos-xxxx.vercel.app`.

## 5. Acessar

- **Administrador:** abra o endereço, entre com usuário `Daniel` e a sua senha.
- **Victor:** envie o mesmo endereço para ele. Ele entra pelo Safari ou Chrome do celular com usuário `Victor` e a senha dele.
- **Vinicius (gestor):** mesmo endereço, usuário `Vinicius`. Vê só o que o Victor vende, a calculadora de comissão,
  libera produtos e clientes. O que ele pode fazer é ajustado em **Configurações → Usuários e gestores**.
- O usuário não diferencia maiúsculas e minúsculas (`Victor` = `victor`).

Primeiros passos do administrador:
**Configurações** (dados da empresa e logotipo do PDF) → **Marcas e categorias** → **Produtos**
(informe "Unidades por caixa" nos produtos vendidos em caixa) → **Clientes** (ative e defina o vendedor) →
**Vendedores** (complete CPF e telefone do Victor).

## 6. Domínio próprio (opcional)

Em **Settings → Domains**, adicione um domínio (ex.: `pedidos.della.com.br`) e siga as instruções de DNS.

## Atualizações

Cada `git push` na branch conectada gera um novo deploy automaticamente. As migrações do banco são
aplicadas no build e o seed não altera usuários que já existem.

## Limites a conhecer

- Imagens: até 4 MB por arquivo. Fotos tiradas no celular são reduzidas automaticamente antes do envio.
- Plano gratuito do Neon: 0,5 GB de armazenamento, suficiente para milhares de pedidos e centenas de imagens.
  Faça backup periódico (`pg_dump` com a `DATABASE_URL_UNPOOLED`; veja o README).
