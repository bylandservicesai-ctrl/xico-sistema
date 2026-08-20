// Analise de cada empresa com IA (Gemini free tier, mesma chave/API ja usada
// no sistema de disparo WhatsApp) para preencher: tem site, problema
// principal e se precisa de automacao.
const { GoogleGenAI } = require("@google/genai");

const MODELO = "gemini-flash-lite-latest";

function criarCliente() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada no .env");
  return new GoogleGenAI({ apiKey });
}

const PROMPT_SISTEMA = `Você analisa pequenos negócios para um vendedor de automação e sites descobrir oportunidades de venda.

Você recebe: nome da empresa, nicho, cidade, endereço e se ela aparece com site cadastrado no OpenStreetMap.

Responda APENAS em JSON válido, neste formato exato, sem markdown, sem texto antes ou depois:
{"tem_site": true ou false, "problema_principal": "string curta em português", "precisa_automacao": true ou false}

Regras:
- "tem_site": use o dado informado sobre o OpenStreetMap como principal indício; se não houver indicação de site, considere que não tem.
- "problema_principal": uma frase curta e concreta (ex: "sem site", "site desatualizado", "sem WhatsApp Business", "depende só de indicação boca a boca"). Nunca genérico como "baixa presença digital".
- "precisa_automacao": true se o nicho e porte sugerem que agendamento, atendimento ou vendas por WhatsApp ainda são manuais e se beneficiariam de automação (ex: salões, clínicas, oficinas, restaurantes pequenos). false se o negócio tipicamente já não precisa (ex: negócio muito pequeno e informal, ou nicho onde automação não se aplica).`;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// O Gemini às vezes devolve 503 (alta demanda), transitório - tenta de novo
// algumas vezes antes de desistir, em vez de marcar a empresa como erro.
async function gerarComRetry(client, params, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try {
      return await client.models.generateContent(params);
    } catch (err) {
      const transitorio = /503|UNAVAILABLE|overloaded|high demand|429|RESOURCE_EXHAUSTED/i.test(err.message || "");
      if (!transitorio || i === tentativas - 1) throw err;
      await esperar(2000 * (i + 1));
    }
  }
}

async function analisarEmpresa(client, empresa) {
  const contexto = `Nome: ${empresa.nome_empresa}
Nicho: ${empresa.nicho}
Cidade: ${empresa.cidade}
Endereço: ${empresa.endereco || "não informado"}
Aparece com site no OpenStreetMap: ${empresa.tem_site_osm ? "sim" : "não"}`;

  const resposta = await gerarComRetry(client, {
    model: MODELO,
    contents: `${PROMPT_SISTEMA}\n\n${contexto}`,
    config: { responseMimeType: "application/json" },
  });

  const texto = (resposta.text || "{}").trim();
  let parsed;
  try {
    const match = texto.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : texto);
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return {
      tem_site: empresa.tem_site_osm,
      problema_principal: "não foi possível analisar automaticamente",
      precisa_automacao: null,
    };
  }

  return {
    tem_site: typeof parsed.tem_site === "boolean" ? parsed.tem_site : empresa.tem_site_osm,
    problema_principal: parsed.problema_principal || "",
    precisa_automacao: typeof parsed.precisa_automacao === "boolean" ? parsed.precisa_automacao : null,
  };
}

// Analisa a lista inteira, sequencialmente (respeita o limite de requisições
// por minuto do free tier do Gemini), chamando onProgresso a cada empresa.
async function analisarLista(empresas, onProgresso) {
  const client = criarCliente();
  const resultado = [];

  for (let i = 0; i < empresas.length; i++) {
    const empresa = empresas[i];
    try {
      const analise = await analisarEmpresa(client, empresa);
      const atualizada = { ...empresa, ...analise };
      resultado.push(atualizada);
      if (onProgresso) onProgresso(atualizada, i, empresas.length);
    } catch (err) {
      const atualizada = {
        ...empresa,
        tem_site: empresa.tem_site_osm,
        problema_principal: "erro ao analisar: " + err.message,
        precisa_automacao: null,
      };
      resultado.push(atualizada);
      if (onProgresso) onProgresso(atualizada, i, empresas.length);
    }
    if (i < empresas.length - 1) await esperar(4200);
  }

  return resultado;
}

module.exports = { analisarLista, analisarEmpresa, criarCliente };
