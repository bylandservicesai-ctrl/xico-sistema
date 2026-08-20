// Busca de empresas via OpenStreetMap (Nominatim + Overpass) - gratuita, sem
// chave de API. Mesma engine usada no sistema de disparo WhatsApp
// (PROMPT DISPARO/src/descoberta.js), adaptada aqui para busca avulsa por
// nicho + cidade digitados livremente pelo usuario, em vez da fila giratoria.
const crypto = require("crypto");

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const TIMEOUT_MS = 20000;
const USER_AGENT = "xico-captacao-leads/1.0 (uso pessoal)";

async function fetchComTimeout(url, opcoes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opcoes, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Mapa nicho (portugues) -> tag do OpenStreetMap.
const NICHO_PARA_TAG = {
  restaurante: "amenity=restaurant",
  pizzaria: "amenity=restaurant",
  lanchonete: "amenity=fast_food",
  padaria: "shop=bakery",
  "clínica odontológica": "amenity=dentist",
  odontologia: "amenity=dentist",
  dentista: "amenity=dentist",
  clínica: "amenity=clinic",
  "salão de beleza": "shop=hairdresser",
  cabeleireiro: "shop=hairdresser",
  barbearia: "shop=hairdresser",
  estética: "shop=beauty",
  academia: "leisure=fitness_centre",
  oficina: "shop=car_repair",
  "estética automotiva": "shop=car_repair",
  imobiliária: "office=estate_agent",
  contabilidade: "office=accountant",
  contador: "office=accountant",
  arquitetura: "office=architect",
  advocacia: "office=lawyer",
  advogado: "office=lawyer",
  "pet shop": "shop=pet",
  farmácia: "amenity=pharmacy",
  mercado: "shop=supermarket",
  mercadinho: "shop=supermarket",
  hotel: "tourism=hotel",
  pousada: "tourism=guest_house",
  floricultura: "shop=florist",
  ótica: "shop=optician",
  joalheria: "shop=jewelry",
  "loja de roupa": "shop=clothes",
  roupas: "shop=clothes",
  moda: "shop=clothes",
  "loja de calçados": "shop=shoes",
  sapataria: "shop=shoes",
  papelaria: "shop=stationery",
  "loja de celular": "shop=mobile_phone",
  "assistência técnica": "shop=mobile_phone",
  móveis: "shop=furniture",
  marcenaria: "shop=furniture",
};

function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

// Tenta achar o nicho digitado dentro do mapa conhecido, mesmo com acentos
// diferentes ou como parte de uma frase (ex: "salao de beleza feminino").
function resolverNicho(nichoDigitado) {
  const alvo = normalizar(nichoDigitado);
  for (const chave of Object.keys(NICHO_PARA_TAG)) {
    if (normalizar(chave) === alvo) return chave;
  }
  for (const chave of Object.keys(NICHO_PARA_TAG)) {
    const chaveNorm = normalizar(chave);
    if (alvo.includes(chaveNorm) || chaveNorm.includes(alvo)) return chave;
  }
  return null;
}

function nichosSuportados() {
  return Object.keys(NICHO_PARA_TAG);
}

async function geocodificarCidade(cidade) {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(cidade + ", Brazil")}&format=json&limit=1`;
  const resposta = await fetchComTimeout(url, { headers: { "User-Agent": USER_AGENT } });
  if (!resposta.ok) throw new Error(`Nominatim retornou ${resposta.status}`);
  const dados = await resposta.json();
  if (!dados.length) throw new Error(`Cidade "${cidade}" não encontrada`);
  const [sul, norte, oeste, leste] = dados[0].boundingbox.map(Number);
  return { sul, norte, oeste, leste };
}

function extrairEndereco(tags) {
  const partes = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean);
  return partes.join(", ") || "";
}

function extrairTelefone(tags) {
  const bruto = tags.phone || tags["contact:phone"] || "";
  return bruto.replace(/\D/g, "");
}

async function buscarPOIs(cidade, nichoResolvido, limite = 20) {
  const tag = NICHO_PARA_TAG[nichoResolvido];
  if (!tag) return [];

  const bbox = await geocodificarCidade(cidade);
  const [chave, valor] = tag.split("=");
  const query = `
    [out:json][timeout:25];
    (
      node["${chave}"="${valor}"](${bbox.sul},${bbox.oeste},${bbox.norte},${bbox.leste});
      way["${chave}"="${valor}"](${bbox.sul},${bbox.oeste},${bbox.norte},${bbox.leste});
    );
    out center tags;
  `;

  let dados;
  let ultimoErro;
  for (const url of OVERPASS_URLS) {
    try {
      const resposta = await fetchComTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!resposta.ok) throw new Error(`Overpass retornou ${resposta.status}`);
      dados = await resposta.json();
      break;
    } catch (err) {
      ultimoErro = err;
    }
  }
  if (!dados) throw new Error(`Não foi possível consultar o mapa agora: ${ultimoErro?.message}`);

  return (dados.elements || [])
    .filter((el) => el.tags?.name)
    .slice(0, limite)
    .map((el) => ({
      id: crypto.randomUUID(),
      nome_empresa: el.tags.name,
      telefone: extrairTelefone(el.tags),
      endereco: extrairEndereco(el.tags),
      cidade,
      nicho: nichoResolvido,
      tem_site_osm: Boolean(el.tags.website || el.tags["contact:website"]),
      categoria_osm: valor,
    }));
}

module.exports = { buscarPOIs, resolverNicho, nichosSuportados, NICHO_PARA_TAG };
