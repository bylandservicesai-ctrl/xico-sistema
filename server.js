require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const express = require("express");

const { buscarPOIs, resolverNicho, nichosSuportados } = require("./src/descoberta");
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
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hora - tempo de sobra pro front consultar o resultado

// Sem isso, cada busca deixaria um job preso na memória pra sempre (o
// processo do Render fica rodando por dias) - com o tempo isso cresceria
// sem limite. Marca cada job com a hora de criação e limpa os antigos
// periodicamente.
setInterval(() => {
  const agora = Date.now();
  for (const [id, job] of jobs) {
    if (agora - job.criadoEm > JOB_TTL_MS) jobs.delete(id);
  }
}, 10 * 60 * 1000);

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
  jobs.set(jobId, { status: "buscando", total: 0, feitos: 0, empresas: [], erro: null, criadoEm: Date.now() });

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

app.get("/api/nichos", (req, res) => {
  res.json({ nichos: nichosSuportados() });
});

app.listen(PORT, () => {
  console.log(`Xico - captação de leads rodando em http://localhost:${PORT}`);
});
