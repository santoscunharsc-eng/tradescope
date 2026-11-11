# TradeScope AI — Guia de publicação (passo a passo)

Estrutura:

```
tradescope/
  index.html        página principal (front-end)
  terms.html        termos de uso (template)
  privacy.html      política de privacidade (template)
  api/generate.js   backend (sua chave Gemini fica aqui, nunca no navegador)
  package.json
  .env.example      variáveis de ambiente
```

## 1. Lemon Squeezy (pagamento + licença)
1. Crie conta em lemonsqueezy.com e uma Store.
2. Crie um produto de **pagamento único, US$ 19**, e ative **"Generate license keys"** (ativações: 1 a 3).
3. Copie o link de checkout do produto e cole em `index.html` na constante `CHECKOUT_URL`.
4. Anote o **Store ID** e o **Product ID** (para `LS_STORE_ID` e `LS_PRODUCT_ID`). Sem isso, a chave de qualquer outro produto da plataforma seria aceita.
5. Lemon Squeezy é "merchant of record": cuida de impostos (sales tax, GST/HST, IVA suíço) por você. Pagamentos chegam por Payoneer/Stripe/banco; confira o que é aceito para o seu país.

## 2. Gemini (Google)
Crie a chave em aistudio.google.com/apikey, no projeto que tem o plano pago, e defina um alerta/limite de orçamento no Google Cloud. Em `GEMINI_MODEL`, use o modelo atual recomendado no AI Studio.

## 3. Upstash (limite do plano grátis)
Crie um banco Redis gratuito em upstash.com e copie `REST URL` e `REST TOKEN`. Sem isso, o limite de 2 gerações grátis usa memória temporária e **não é confiável**.

## 4. Publicar na Vercel
1. Suba a pasta `tradescope` para um repositório no GitHub (ou use `npx vercel` na pasta).
2. Na Vercel: New Project, importe o repositório.
3. Em Settings, Environment Variables, adicione as variáveis do `.env.example`.
4. Deploy. Depois conecte seu domínio em Settings, Domains.

## 5. Antes de divulgar
- Troque `SUPPORT_EMAIL` em `index.html` e preencha os campos `[entre colchetes]` em `terms.html` e `privacy.html`. **Peça revisão de um advogado**: os textos são modelos.
- Faça uma compra de teste (modo Test do Lemon Squeezy), cole a chave e gere um SOW.
- Teste: 3 gerações sem chave (a 3ª deve abrir o modal de compra).

## 6. Primeiras vendas
- Grupos de Facebook e Reddit (r/Carpentry, r/woodworking, r/Contractor, r/smallbusiness): mostre o resultado, não faça spam.
- Poste exemplos antes/depois de um SOW no LinkedIn e no YouTube Shorts.
- Contate marcenarias e pequenos empreiteiros locais por e-mail com um SOW de exemplo gerado para o negócio deles.
- Cobre por valor: um SOW ruim custa milhares de dólares em disputa; US$ 19 é fácil de justificar.

## Custos e limites
- Hospedagem Vercel + Upstash: grátis no início.
- Ajuste `PAID_MONTHLY_LIMIT` para proteger sua margem.
- Para recorrência (ex.: US$ 9/mês), crie um produto de assinatura no Lemon Squeezy e mantenha o mesmo código.
