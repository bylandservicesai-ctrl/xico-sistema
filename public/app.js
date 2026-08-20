const telaBusca = document.getElementById("tela-busca");
const telaProgresso = document.getElementById("tela-progresso");
const telaResultado = document.getElementById("tela-resultado");
const mensagemErro = document.getElementById("mensagem-erro");
const textoProgresso = document.getElementById("texto-progresso");
const listaEmpresas = document.getElementById("lista-empresas");
const contagemResultado = document.getElementById("contagem-resultado");
const spinner = document.getElementById("spinner");
const barraContainer = document.getElementById("barra-progresso-container");
const barra = document.getElementById("barra-progresso");

const CHAVE_HISTORICO = "xico_historico";
const MAX_HISTORICO = 15;

let empresasAtuais = [];

// ---------- Abas ----------

function mostrarAba(nomeAba) {
  document.querySelectorAll(".tab-conteudo").forEach((secao) => {
    secao.hidden = secao.id !== `tab-${nomeAba}`;
  });
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("ativo", btn.dataset.tab === nomeAba);
  });
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => mostrarAba(btn.dataset.tab));
});

// ---------- Busca ----------

function mostrarTela(tela) {
  [telaBusca, telaProgresso, telaResultado].forEach((t) => (t.hidden = t !== tela));
}

function tagSimNao(valor, textoSim, textoNao) {
  if (valor === true) return `<span class="tag sim">${textoSim}</span>`;
  if (valor === false) return `<span class="tag nao">${textoNao}</span>`;
  return `<span class="tag duvida">não sei dizer</span>`;
}

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

function renderizarResultado(empresas) {
  contagemResultado.textContent = `${empresas.length} empresa${empresas.length === 1 ? "" : "s"} encontrada${empresas.length === 1 ? "" : "s"}`;
  listaEmpresas.innerHTML = empresas
    .map(
      (e) => `
    <li class="card-empresa">
      <h3>${escaparHtml(e.nome_empresa)}</h3>
      <div class="linha">📞 ${e.telefone ? escaparHtml(e.telefone) : "telefone não encontrado"}</div>
      <div class="linha">${tagSimNao(e.tem_site, "tem site", "sem site")} ${tagSimNao(e.precisa_automacao, "precisa automação", "não precisa")}</div>
      <div class="linha">${escaparHtml(e.problema_principal || "")}</div>
      ${e.endereco ? `<div class="linha endereco">📍 ${escaparHtml(e.endereco)}</div>` : ""}
    </li>
  `
    )
    .join("");
}

async function buscar() {
  const nicho = document.getElementById("nicho").value.trim();
  const cidade = document.getElementById("cidade").value.trim();
  mensagemErro.hidden = true;

  if (!nicho || !cidade) {
    mensagemErro.textContent = "Preencha o que você procura e a cidade.";
    mensagemErro.hidden = false;
    return;
  }

  mostrarTela(telaProgresso);
  spinner.hidden = false;
  barraContainer.hidden = true;
  barra.style.width = "0%";
  textoProgresso.textContent = "Buscando empresas no mapa...";

  try {
    const resposta = await fetch("/api/buscar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nicho, cidade }),
    });
    const dados = await resposta.json();

    if (!resposta.ok) {
      throw new Error(dados.erro || "Não foi possível buscar agora.");
    }

    await acompanharJob(dados.jobId, nicho, cidade);
  } catch (err) {
    mostrarTela(telaBusca);
    mensagemErro.textContent = err.message;
    mensagemErro.hidden = false;
  }
}

function acompanharJob(jobId, nicho, cidade) {
  return new Promise((resolve, reject) => {
    const intervalo = setInterval(async () => {
      try {
        const resposta = await fetch(`/api/buscar/${jobId}`);
        const job = await resposta.json();

        if (!resposta.ok) {
          clearInterval(intervalo);
          reject(new Error(job.erro || "Erro ao consultar a busca."));
          return;
        }

        if (job.status === "buscando") {
          spinner.hidden = false;
          barraContainer.hidden = true;
          textoProgresso.textContent = "Buscando empresas no mapa...";
        } else if (job.status === "analisando") {
          spinner.hidden = true;
          barraContainer.hidden = false;
          const percentual = job.total ? Math.round((job.feitos / job.total) * 100) : 0;
          barra.style.width = `${percentual}%`;
          textoProgresso.textContent = `Analisando empresas (${job.feitos}/${job.total})...`;
        } else if (job.status === "concluido") {
          clearInterval(intervalo);
          empresasAtuais = job.empresas;
          if (!empresasAtuais.length) {
            reject(new Error("Nenhuma empresa com telefone cadastrado encontrada para essa busca. Tente outro nicho ou cidade."));
            return;
          }
          salvarNoHistorico(nicho, cidade, empresasAtuais);
          renderizarResultado(empresasAtuais);
          mostrarTela(telaResultado);
          resolve();
        } else if (job.status === "erro") {
          clearInterval(intervalo);
          reject(new Error(job.erro || "Erro na busca."));
        }
      } catch (err) {
        clearInterval(intervalo);
        reject(err);
      }
    }, 1500);
  });
}

function gerarTextoLista() {
  return empresasAtuais
    .map((e) => {
      const site = e.tem_site ? "tem site" : "sem site";
      const automacao = e.precisa_automacao ? "precisa de automação" : "não precisa de automação";
      return `*${e.nome_empresa}*\nTelefone: ${e.telefone || "não encontrado"}\n${site} | ${automacao}\nProblema: ${e.problema_principal || "-"}`;
    })
    .join("\n\n");
}

function gerarCsv() {
  const cabecalho = ["Nome", "Telefone", "Tem site", "Problema principal", "Precisa automação", "Cidade"];
  const linhas = empresasAtuais.map((e) => [
    e.nome_empresa,
    e.telefone,
    e.tem_site ? "Sim" : "Não",
    e.problema_principal || "",
    e.precisa_automacao ? "Sim" : "Não",
    e.cidade,
  ]);
  const escaparCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cabecalho, ...linhas].map((linha) => linha.map(escaparCsv).join(",")).join("\n");
}

document.getElementById("btn-buscar").addEventListener("click", buscar);

document.getElementById("btn-nova-busca").addEventListener("click", () => {
  document.getElementById("nicho").value = "";
  document.getElementById("cidade").value = "";
  mostrarTela(telaBusca);
});

document.getElementById("btn-copiar").addEventListener("click", async () => {
  const texto = gerarTextoLista();
  try {
    await navigator.clipboard.writeText(texto);
    alert("Lista copiada! Agora é só colar no WhatsApp ou na planilha.");
  } catch {
    alert("Não foi possível copiar automaticamente. Selecione o texto manualmente.");
  }
});

document.getElementById("btn-csv").addEventListener("click", () => {
  const csv = "﻿" + gerarCsv();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leads.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ---------- Histórico (salvo no navegador) ----------

function carregarHistorico() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_HISTORICO) || "[]");
  } catch {
    return [];
  }
}

function salvarNoHistorico(nicho, cidade, empresas) {
  const historico = carregarHistorico();
  historico.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    nicho,
    cidade,
    data: new Date().toISOString(),
    empresas,
  });
  localStorage.setItem(CHAVE_HISTORICO, JSON.stringify(historico.slice(0, MAX_HISTORICO)));
  renderizarHistorico();
}

function formatarData(iso) {
  const data = new Date(iso);
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " às " + data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function renderizarHistorico() {
  const historico = carregarHistorico();
  const lista = document.getElementById("lista-historico");
  const vazio = document.getElementById("historico-vazio");

  if (!historico.length) {
    lista.innerHTML = "";
    vazio.hidden = false;
    return;
  }
  vazio.hidden = true;

  lista.innerHTML = historico
    .map(
      (item) => `
    <li>
      <button class="item-historico" data-id="${item.id}">
        <div class="titulo">${escaparHtml(item.nicho)} — ${escaparHtml(item.cidade)}</div>
        <div class="detalhe">${item.empresas.length} empresa${item.empresas.length === 1 ? "" : "s"} · ${formatarData(item.data)}</div>
      </button>
    </li>
  `
    )
    .join("");

  lista.querySelectorAll(".item-historico").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = historico.find((h) => h.id === btn.dataset.id);
      if (!item) return;
      empresasAtuais = item.empresas;
      renderizarResultado(empresasAtuais);
      mostrarAba("buscar");
      mostrarTela(telaResultado);
    });
  });
}

// ---------- Referência de nichos + autocomplete ----------

async function carregarNichos() {
  try {
    const resposta = await fetch("/api/nichos");
    const dados = await resposta.json();
    const nichos = (dados.nichos || []).slice().sort((a, b) => a.localeCompare(b, "pt-BR"));

    const datalist = document.getElementById("lista-nichos");
    datalist.innerHTML = nichos.map((n) => `<option value="${escaparHtml(n)}"></option>`).join("");

    renderizarNichosRef(nichos);
    document.getElementById("filtro-nichos").addEventListener("input", (ev) => {
      const filtro = ev.target.value.trim().toLowerCase();
      renderizarNichosRef(nichos.filter((n) => n.toLowerCase().includes(filtro)));
    });
  } catch {
    // Sem lista de referência não impede o uso do app - a busca livre continua funcionando.
  }
}

function renderizarNichosRef(nichos) {
  const lista = document.getElementById("lista-nichos-ref");
  lista.innerHTML = nichos.map((n) => `<li>${escaparHtml(n)}</li>`).join("");
}

renderizarHistorico();
carregarNichos();
