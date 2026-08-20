# Captação de Leads (Xico)

Ferramenta web simples, separada do sistema de disparo WhatsApp, para uso do
Xico: busca empresas por nicho + cidade, analisa cada uma com IA e exporta a
lista. Não alimenta a fila de disparo — é só para captação e exportação.

## Como funciona

- Busca de empresas: reaproveita a mesma engine gratuita do sistema de
  disparo (OpenStreetMap via Nominatim + Overpass, sem chave de API) —
  ver `src/descoberta.js`.
- Análise de cada empresa: usa a mesma `GEMINI_API_KEY` já usada no sistema
  de disparo (Google Gemini, free tier) para preencher se tem site, o
  problema principal e se precisa de automação — ver `src/analise.js`.

## Rodar localmente

```bash
npm install
npm start
```

Abra `http://localhost:3000` no navegador.

## Deploy gratuito (para acessar pelo celular)

Recomendado: [Render.com](https://render.com) (free tier, Web Service):

1. Suba esta pasta para um repositório Git (GitHub, por exemplo).
2. No Render, crie um "Web Service" novo apontando para o repositório.
   - Build command: `npm install`
   - Start command: `npm start`
3. Em "Environment", adicione a variável `GEMINI_API_KEY` com o mesmo valor
   usado no sistema de disparo.
4. Depois do deploy, o Render te dá um link público (ex:
   `https://xico-leads.onrender.com`) — é esse link que o Xico abre no
   celular.

Observação: no free tier do Render, o serviço "dorme" depois de um tempo sem
uso e demora ~30s para acordar na primeira busca do dia — normal, não é bug.

## Limites

- Até 10 empresas por busca (evita demorar demais e estourar o limite
  gratuito do Gemini). A mesma loja nunca aparece duas vezes na lista.
- Só entram empresas com telefone cadastrado no mapa (sem telefone não dá
  pra prospectar por WhatsApp). Em cidades pequenas isso pode retornar
  poucas empresas, ou nenhuma.
- Nichos reconhecidos: cerca de 90 termos (salão de beleza, restaurante,
  oficina, clínica odontológica, academia, loja de roupa, etc. — ver a lista
  completa em `src/descoberta.js`, `NICHO_PARA_TAG`).
