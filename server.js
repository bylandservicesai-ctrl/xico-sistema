require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const express = require("express");

const { buscarPOIs, resolverNicho } = require("./src/descoberta");
const { analisarLista } = require("./src/analise");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const LIMITE_EMPRESAS = 10;

// Jobs em memória: a busca + análise demora (rate limit do Gemini), então o
// front dispara o job e fica consultando o progresso em vez de segurar uma
// requisição HTTP aberta por 1-2 minutos.
const jobs = new Map();

app.post("/api/buscar", async (req, res) => {
  const nicho = (req.body?.nicho || "").trim();
  const cidade = (req.body?.cidade || "").trim();

  if (!nicho || !cidade) {
    return res.status(400).json({ erro: "Preencha o nicho e a cidade." });
  }

  const nichoResolvido = resolverNicho(nicho);
  if (!nichoResolvido) {
    return res.status(400).json({
      erro: `Não reconheço o nicho "${nicho}". Tente algo como: salão de beleza, restaurante, oficina, academia, clínica odontológica.`,
    });
  }

  const jobId = crypto.randomUUID();
  jobs.set(jobId, { status: "buscando", total: 0, feitos: 0, empresas: [], erro: null });

  processarJob(jobId, nichoResolvido, cidade).catch((err) => {
    const job = jobs.get(jobId);
    if (job) {
      job.status = "erro";
      job.erro = err.message;
    }
  });

  res.json({ jobId });
});

async function processarJob(jobId, nichoResolvido, cidade) {
  const job = jobs.get(jobId);

  const encontradas = await buscarPOIs(cidade, nichoResolvido, LIMITE_EMPRESAS);
  if (!encontradas.length) {
    job.status = "concluido";
    job.total = 0;
    return;
  }

  job.status = "analisando";
  job.total = encontradas.length;
  job.empresas = encontradas;

  await analisarLista(encontradas, (empresaAtualizada, indice) => {
    job.empresas[indice] = empresaAtualizada;
    job.feitos = indice + 1;
  });

  job.status = "concluido";
}

app.get("/api/buscar/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ erro: "Busca não encontrada." });
  res.json(job);
});

// Diagnóstico temporário: testa se o próprio servidor consegue falar com o
// Overpass, pra descartar bloqueio de rede/IP específico do Render.
app.get("/api/diagnostico", async (req, res) => {
  const resultado = {};
  const inicio = Date.now();
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent('[out:json][timeout:20];node["shop"="hairdresser"](-29.83,-51.18,-29.64,-50.93);out center tags 5;'),
    });
    const texto = await r.text();
    resultado.overpass = { status: r.status, ms: Date.now() - inicio, tamanho: texto.length, amostra: texto.slice(0, 200) };
  } catch (err) {
    resultado.overpass = {
      erro: err.message,
      causa: err.cause ? { message: err.cause.message, code: err.cause.code } : null,
      ms: Date.now() - inicio,
    };
  }

  const inicio2 = Date.now();
  try {
    const r2 = await fetch("https://nominatim.openstreetmap.org/search?q=Novo+Hamburgo,+Brazil&format=json&limit=1", {
      headers: { "User-Agent": "xico-captacao-leads/1.0" },
    });
    const texto2 = await r2.text();
    resultado.nominatim = { status: r2.status, ms: Date.now() - inicio2, amostra: texto2.slice(0, 150) };
  } catch (err) {
    resultado.nominatim = {
      erro: err.message,
      causa: err.cause ? { message: err.cause.message, code: err.cause.code } : null,
      ms: Date.now() - inicio2,
    };
  }

  const inicio3 = Date.now();
  try {
    const r3 = await fetch("https://api.ipify.org?format=json");
    resultado.meuIp = await r3.json();
    resultado.meuIp.ms = Date.now() - inicio3;
  } catch (err) {
    resultado.meuIp = { erro: err.message };
  }

  res.json(resultado);
});

app.listen(PORT, () => {
  console.log(`Xico - captação de leads rodando em http://localhost:${PORT}`);
});
