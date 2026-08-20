const telaBusca = document.getElementById("tela-busca");
const telaProgresso = document.getElementById("tela-progresso");
const telaResultado = document.getElementById("tela-resultado");
const mensagemErro = document.getElementById("mensagem-erro");
const textoProgresso = document.getElementById("texto-progresso");
const listaEmpresas = document.getElementById("lista-empresas");
const contagemResultado = document.getElementById("contagem-resultado");

let empresasAtuais = [];

function mostrarTela(tela) {
  [telaBusca, telaProgresso, telaResultado].forEach((t) => (t.hidden = t !== tela));
}

function tagSimNao(valor, textoSim, textoNao) {
  if (valor === true) return `<span class="tag sim">${textoSim}</span>`;
  if (valor === false) return `<span class="tag nao">${textoNao}</span>`;
  return `<span class="tag duvida">não sei dizer</span>`;
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
    </li>
  `
    )
    .join("");
}

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
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

    await acompanharJob(dados.jobId);
  } catch (err) {
    mostrarTela(telaBusca);
    mensagemErro.textContent = err.message;
    mensagemErro.hidden = false;
  }
}

function acompanharJob(jobId) {
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
          textoProgresso.textContent = "Buscando empresas no mapa...";
        } else if (job.status === "analisando") {
          textoProgresso.textContent = `Analisando empresas (${job.feitos}/${job.total})...`;
        } else if (job.status === "concluido") {
          clearInterval(intervalo);
          empresasAtuais = job.empresas;
          if (!empresasAtuais.length) {
            reject(new Error("Nenhuma empresa encontrada para essa busca. Tente outro nicho ou cidade."));
            return;
          }
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
