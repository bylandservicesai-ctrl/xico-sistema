// Busca de empresas via OpenStreetMap (Nominatim + Overpass) - gratuita, sem
// chave de API. Mesma engine usada no sistema de disparo WhatsApp
// (PROMPT DISPARO/src/descoberta.js), adaptada aqui para busca avulsa por
// nicho + cidade digitados livremente pelo usuario, em vez da fila giratoria.
const crypto = require("crypto");

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const TIMEOUT_GEOCODE_MS = 15000;
const TIMEOUT_OVERPASS_MS = 45000;
const USER_AGENT = "xico-captacao-leads/1.0 (uso pessoal)";

async function fetchComTimeout(url, opcoes, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opcoes, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Mapa nicho (portugues) -> tag do OpenStreetMap. Cobre os pequenos negocios
// mais comuns no Brasil; varias entradas repetem a mesma tag como sinonimos
// (ex: "cabeleireiro" e "barbearia" caem na mesma tag que "salao de beleza").
const NICHO_PARA_TAG = {
  // Alimentação
  restaurante: "amenity=restaurant",
  pizzaria: "amenity=restaurant",
  churrascaria: "amenity=restaurant",
  lanchonete: "amenity=fast_food",
  "fast food": "amenity=fast_food",
  hamburgueria: "amenity=fast_food",
  pastelaria: "amenity=fast_food",
  sorveteria: "amenity=ice_cream",
  açaiteria: "amenity=ice_cream",
  cafeteria: "amenity=cafe",
  café: "amenity=cafe",
  bar: "amenity=bar",
  pub: "amenity=pub",
  padaria: "shop=bakery",
  confeitaria: "shop=bakery",
  doceria: "shop=confectionery",
  açougue: "shop=butcher",
  peixaria: "shop=seafood",
  hortifruti: "shop=greengrocer",
  adega: "shop=alcohol",
  "distribuidora de bebidas": "shop=alcohol",

  // Beleza e saúde
  "salão de beleza": "shop=hairdresser",
  cabeleireiro: "shop=hairdresser",
  barbearia: "shop=hairdresser",
  manicure: "shop=beauty",
  estética: "shop=beauty",
  spa: "leisure=spa",
  "clínica odontológica": "amenity=dentist",
  odontologia: "amenity=dentist",
  dentista: "amenity=dentist",
  clínica: "amenity=clinic",
  "clínica médica": "amenity=clinic",
  hospital: "amenity=hospital",
  farmácia: "amenity=pharmacy",
  veterinária: "amenity=veterinary",
  "pet shop": "shop=pet",
  academia: "leisure=fitness_centre",
  crossfit: "leisure=fitness_centre",
  pilates: "leisure=fitness_centre",

  // Automotivo
  oficina: "shop=car_repair",
  mecânica: "shop=car_repair",
  "estética automotiva": "shop=car_repair",
  borracharia: "shop=tyres",
  "auto peças": "shop=car_parts",
  "lava rápido": "shop=car_wash",
  concessionária: "shop=car",

  // Varejo / lojas
  "loja de roupa": "shop=clothes",
  roupas: "shop=clothes",
  moda: "shop=clothes",
  "loja de calçados": "shop=shoes",
  sapataria: "shop=shoes",
  papelaria: "shop=stationery",
  "loja de celular": "shop=mobile_phone",
  "assistência técnica": "shop=mobile_phone",
  eletrônica: "shop=electronics",
  informática: "shop=computer",
  móveis: "shop=furniture",
  marcenaria: "shop=furniture",
  "material de construção": "shop=hardware",
  ferragens: "shop=hardware",
  tintas: "shop=paint",
  livraria: "shop=books",
  brinquedos: "shop=toys",
  joalheria: "shop=jewelry",
  ótica: "shop=optician",
  floricultura: "shop=florist",
  mercado: "shop=supermarket",
  mercadinho: "shop=supermarket",
  conveniência: "shop=convenience",

  // Serviços e profissionais
  imobiliária: "office=estate_agent",
  contabilidade: "office=accountant",
  contador: "office=accountant",
  arquitetura: "office=architect",
  advocacia: "office=lawyer",
  advogado: "office=lawyer",
  seguros: "office=insurance",
  "agência de viagens": "office=travel_agent",
  gráfica: "shop=copyshop",
  lavanderia: "shop=laundry",
  costureira: "craft=tailor",
  alfaiataria: "craft=tailor",
  chaveiro: "shop=locksmith",

  // Hospedagem
  hotel: "tourism=hotel",
  pousada: "tourism=guest_house",
  hostel: "tourism=hostel",

  // Educação
  escola: "amenity=school",
  autoescola: "amenity=driving_school",
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

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// O Nominatim (serviço público e gratuito) às vezes demora ou falha de forma
// transitória, especialmente vindo de servidores em nuvem compartilhados
// (Render, etc). Tenta de novo uma vez, com mais tempo, antes de desistir.
async function geocodificarCidade(cidade) {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(cidade + ", Brazil")}&format=json&limit=1`;
  let ultimoErro;

  for (const timeoutMs of [TIMEOUT_GEOCODE_MS, TIMEOUT_GEOCODE_MS * 2]) {
    try {
      const resposta = await fetchComTimeout(url, { headers: { "User-Agent": USER_AGENT } }, timeoutMs);
      if (!resposta.ok) throw new Error(`Nominatim retornou ${resposta.status}`);
      const dados = await resposta.json();
      if (!dados.length) throw new Error(`Cidade "${cidade}" não encontrada`);
      const [sul, norte, oeste, leste] = dados[0].boundingbox.map(Number);
      return { sul, norte, oeste, leste };
    } catch (err) {
      ultimoErro = err;
      await esperar(1000);
    }
  }
  if (/cidade .* não encontrada/i.test(ultimoErro.message)) throw ultimoErro;
  throw new Error(`Não consegui localizar a cidade "${cidade}" agora, tente de novo em instantes`);
}

function extrairEndereco(tags) {
  const partes = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean);
  return partes.join(", ") || "";
}

function extrairTelefone(tags) {
  const bruto = tags.phone || tags["contact:phone"] || "";
  return bruto.replace(/\D/g, "");
}

async function buscarPOIs(cidade, nichoResolvido, limite = 10) {
  const tag = NICHO_PARA_TAG[nichoResolvido];
  if (!tag) return [];

  // Pede mais elementos do que o limite final: o mesmo estabelecimento às
  // vezes aparece cadastrado tanto como node quanto como way no OpenStreetMap,
  // e a deduplicação por nome abaixo pode descartar algumas dessas repetições.
  const limiteBusca = limite * 3;

  const bbox = await geocodificarCidade(cidade);
  const [chave, valor] = tag.split("=");
  const query = `
    [out:json][timeout:40];
    (
      node["${chave}"="${valor}"](${bbox.sul},${bbox.oeste},${bbox.norte},${bbox.leste});
      way["${chave}"="${valor}"](${bbox.sul},${bbox.oeste},${bbox.norte},${bbox.leste});
    );
    out center tags ${limiteBusca};
  `;

  let dados;
  let ultimoErro;
  for (const url of OVERPASS_URLS) {
    try {
      const resposta = await fetchComTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
          body: `data=${encodeURIComponent(query)}`,
        },
        TIMEOUT_OVERPASS_MS
      );
      if (!resposta.ok) throw new Error(`Overpass retornou ${resposta.status}`);
      dados = await resposta.json();
      break;
    } catch (err) {
      ultimoErro = err;
    }
  }
  if (!dados) throw new Error("Não foi possível consultar o mapa agora, tente de novo em instantes");

  const nomesVistos = new Set();

  return (dados.elements || [])
    .filter((el) => el.tags?.name)
    .filter((el) => {
      // Deduplica pelo nome (mesma loja às vezes cadastrada mais de uma vez
      // no OpenStreetMap, ou como node e way ao mesmo tempo).
      const chaveNome = normalizar(el.tags.name);
      if (nomesVistos.has(chaveNome)) return false;
      nomesVistos.add(chaveNome);
      return true;
    })
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
