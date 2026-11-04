# caxxa.

Aplicativo de controle financeiro pessoal construído a partir da aba **"Fluxo de Caixa (2)"** da planilha de fluxo de caixa:
planejamento mensal, registro e categorização de despesas, metas, alertas de vencimento, Open Finance e recomendações por IA.

## Funcionalidades

| Tela | O que faz |
|---|---|
| **Painel** | Gastos do mês x planejado, sobra do mês (Saldo 1), patrimônio projetado, despesas por categoria, receitas x despesas, vencimentos e metas. |
| **Fluxo pessoal** | Grade mês a mês editável no mesmo modelo da planilha (ver abaixo), com a coluna **Base** — o orçamento mensal de cada linha, usado nas comparações realizado x orçamento. Aceita valores como `1.234,56` ou fórmulas simples (`=-2337,5-780`, `-400*4`). **Importa a planilha .xlsx** diretamente. |
| **Empresa** *(opcional, para quem é PJ)* | Fluxo de caixa da PJ: faturamento, despesas (fixas ou % do faturamento, ex.: Simples/impostos) e retiradas. Pró-labore e lucro retirados entram **automaticamente como receita no fluxo pessoal**; a retirada marcada como *auto* distribui o resultado que sobrar no mês. Quem é CLT deixa desligado e lança o salário nas Receitas do fluxo pessoal. Liga/desliga em "Recebo pela minha empresa (PJ)" no Fluxo pessoal ou no próprio menu Empresa. |
| **Lançamentos** | Registro de receitas e despesas com categoria sugerida automaticamente, filtros e orçamento do mês (realizado x fluxo de caixa). |
| **Metas** | Objetivos com valor, prazo, aporte mensal necessário e comparação com a sobra projetada. |
| **Contas a pagar** | **Geradas automaticamente** das despesas do Fluxo pessoal e da Empresa (quando ligada), com o valor do mês no fluxo. Edite nome, dia de vencimento e valor (o valor editado atualiza o fluxo daquele mês; despesas em % do faturamento mostram o valor calculado). Marque como paga, oculte o que não é conta (ex.: mercado) e cadastre contas avulsas. Situação (atrasada, vence hoje, em breve) e notificações do navegador. |
| **Open Finance** | Conexão com bancos via agregador [Pluggy](https://pluggy.ai); transações importadas sem duplicar e categorizadas. Sem credenciais, roda em modo sandbox com dados simulados. |
| **Assistente IA** | Previsão de gastos do próximo mês por categoria e recomendações. Com `ANTHROPIC_API_KEY`, usa o Claude para análise personalizada e responde perguntas; sem a chave, usa as regras locais. |

### No celular

- Barra de abas embaixo (Painel, Fluxo, Lançar, Metas e **Mais** com as demais telas, conta e "Sair").
- Fluxo pessoal e Empresa em **visão por mês** (‹ mês ›, uma linha por item com valor editável e a Base), com a tabela completa
  num botão "Tabela".
- Campos com 16px (sem zoom no iPhone), botões com área de toque maior, layout sem rolagem lateral.
- Pode ser instalado na tela inicial ("Adicionar à tela de início"): manifesto e ícones PNG em `public/`
  (`apple-touch-icon.png` 180px para iPhone; 192/512 e versão *maskable* para Android).

### Modelo do fluxo de caixa

```
EMPRESA
Resultado    = Faturamento − Despesas (fixas ou % do faturamento)
Retiradas    = Pró-labore + Lucro (a linha "auto" distribui o resultado que sobrar)
Caixa PJ     = Caixa inicial + Resultado − Retiradas

PESSOAL (igual à planilha)
Saldo 1      = Saldo inicial + Σ despesas pessoais (cartões, condomínio, carro…)
Resgate      = −Saldo 1            → a sobra é aplicada / o déficit é resgatado dos investimentos
Saldo 2      = Saldo 1 + Resgate   (= 0 com resgate automático)
Saldo final  = Saldo 2 + Retiradas da empresa + receitas pessoais (13º, férias…) + extras
Próximo mês  : Saldo inicial = Saldo final
Investimentos: saldo × (1 + taxa mensal) ± Saldo 1 na conta marcada com ⇄; Previdência à parte
```

A importação lê a coluna Base e a linha 1 (meses, mesmo fora de ordem), os blocos `Saldo Inicial → Saldo 1` e `Saldo 2 → Saldo final`,
segue a fórmula de `DESPESAS EMPRESA` até as linhas da PJ (`Impostos PJ`, `INSS`, `Contabilidade`), e lê os investimentos
até `TT INVESTIMENTO` e a `Previdência` (a taxa é extraída de fórmulas como `*(1+0.5%)`).
Como a planilha mistura a PJ no fluxo pessoal, o app separa: o **"Salário" vira o faturamento da empresa**, as despesas PJ vão
para a empresa e o lucro automático devolve ao pessoal Salário − despesas PJ. Os saldos pessoais continuam batendo com os do
Excel (ex.: saldo final de R$ 71.782,06 em dez/26). Dados salvos antes dessa separação são migrados do mesmo jeito.

## Como rodar

Requer Node 20+.

```bash
npm install
```

```bash
cp .env.example .env   # opcional: chaves da IA e do Open Finance
```

```bash
npm run dev            # front em http://localhost:5173, API em :8787
```

Produção (o servidor entrega o front compilado):

```bash
npm run build && npm start
```

Testes:

```bash
npm test
```

## Publicação (Vercel)

Publicado em **https://caxxa.vercel.app** (projeto `caxxa` no time Movirun Club).
O `vercel.json` roda `npm run vercel-build`, que compila o front e empacota a API Express como uma função Node
em `.vercel/output` (Build Output API). As variáveis abaixo são cadastradas em *Project → Settings → Environment Variables*.

## Login, cadastro e onde ficam os dados

- **Cadastro aberto:** na tela inicial, "Criar conta" pede usuário e senha (mín. 8 caracteres) e já entra logado.
  As contas ficam no **Vercel Blob privado** do projeto (`users/<usuário>.json`), só com o hash scrypt da senha.
  Há um limite simples de tentativas por IP para login e cadastro.
- **Contas fixas** em `AUTH_USERS` (ex.: `admin`) continuam valendo e não podem ser recriadas pelo cadastro:

```bash
npm run hash-password -- <usuario> <senha>
```

- A sessão fica num cookie `HttpOnly` assinado (`AUTH_SECRET`), válido por 30 dias. Sem sessão, a API responde 401.
- **Os dados ficam salvos na conta:** cada alteração é gravada na hora no navegador (inclusive se o app for fechado
  no meio da edição) e enviada ao servidor em seguida, no Vercel Blob privado (`data/<usuário>.json`). Ao entrar em outro
  aparelho — ou no app instalado na tela inicial — os dados da conta são carregados. Se dois aparelhos editarem, vale a
  alteração mais recente. Sem conexão, o app continua salvando no aparelho e envia quando voltar.
- Cada usuário só acessa os próprios dados. Contas novas começam com **dados de exemplo pequenos** (perfil CLT) e a pergunta
  "Como você recebe?". "Voltar aos dados de exemplo" substitui os dados da conta pelos exemplos.
- Localmente, sem Blob, use `AUTH_SIGNUP=memory` para testar o cadastro (as contas somem ao reiniciar).

## Configuração

| Variável | Uso |
|---|---|
| `ANTHROPIC_API_KEY` | Ativa as recomendações do Claude (`claude-opus-5-5`, saída estruturada validada com Zod). Só totais agregados são enviados — nunca descrições de lançamentos. |
| `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` | Ativa o Open Finance real. Autorize a conta no Pluggy Connect e cole o *Item ID* na tela Open Finance. |
| `AUTH_USERS` | Usuários e hashes de senha (`usuario:scrypt$…`, separados por vírgula). Vazio = sem login. |
| `AUTH_SECRET` | Chave aleatória para assinar a sessão. |
| `BLOB_READ_WRITE_TOKEN` | Criado pela Vercel ao ligar o Blob privado ao projeto; ativa o cadastro aberto. |
| `PORT` | Porta da API (padrão 8787). |

O servidor lê o arquivo `.env` na raiz automaticamente, se existir.

## Arquitetura

```
src/lib/cashflow.ts   motor do fluxo de caixa (lógica da planilha)
src/lib/analytics.ts  previsão de gastos, alertas, metas, recomendações locais, resumo para a IA
src/lib/store.tsx     estado do app, salvo no localStorage do navegador
src/pages/*           telas
server/importXlsx.ts  leitura da planilha .xlsx (exceljs)
server/ai.ts          recomendações via Claude (Anthropic SDK)
server/openfinance.ts Pluggy / sandbox
```

Os dados ficam no navegador (localStorage). O servidor é sem estado: só repassa chamadas para a IA e o agregador
e lê a planilha enviada — o arquivo não é gravado.

### Próximos passos sugeridos

- Embutir o widget Pluggy Connect para o usuário autorizar o banco sem sair do app.
- Persistência no servidor com login, para sincronizar entre dispositivos.
- Notificações push/e-mail de vencimento mesmo com o app fechado.
