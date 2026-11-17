# 🔧 Agente de Diagnóstico Automotivo + Catálogo de Manuais

Ferramenta **100% offline** para oficinas mecânicas: interpreta códigos de falha
(DTC) de qualquer scanner OBD-II, avalia **dados ao vivo** (trims, temperatura,
MAF, sonda, bateria), cruza sintomas e aponta **causas prováveis rankeadas +
roteiro de testes**. Inclui catálogo navegável de **manuais do proprietário**
(carros, motos e barcos — 7.400+) com download de PDF para uso offline.

> Este projeto é a **fusão e reformulação** de dois repositórios do autor:
> `car-diagnostics-agent` (protótipo CLI em Python) e `agente-diagnostico-dtc`.
> O agente Python foi aposentado em favor de uma base única (`kb.js`) usada
> simultaneamente pela **interface web** e pela **CLI Node**. Veja
> [O que mudou na fusão](#-o-que-mudou-na-fusão) para detalhes.

## Como usar

**1. Interface web** — abra `index.html` (duplo clique, funciona sem servidor).
Três modos de entrada:

| Modo | O que faz |
|---|---|
| **Códigos** | Cole os códigos do scanner (`P0171 P0300 U0100`) e clique em ⚡ Interpretar |
| **JSON do scanner** | Cole/importe o JSON exportado pelo scanner ou app (`samples/scanner-exemplo.json` tem o formato) — o agente cruza veículo + códigos + sintomas + dados ao vivo |
| **Sintoma** | Sem código? Busque por "não parte", "trepidação", "consumo alto"... |

O relatório mostra: título do código, severidade (Leve/Moderada/Crítica),
**causas ordenadas por probabilidade (%)**, **roteiro de testes prático**
(multímetro, osciloscópio, scanner — clique para marcar como feitos),
**análise combinada** entre códigos e **sugestão do manual do veículo**
(✔ LOCAL = PDF já baixado). 🖨️ **Imprimir** gera PDF para o cliente.

**2. CLI (terminal)** — mesma base de conhecimento:

```bash
node tools/diagnostico.mjs samples/scanner-exemplo.json     # analisa JSON do scanner
node tools/diagnostico.mjs --codigos "P0171 P0300 U0100"    # códigos soltos
node tools/diagnostico.mjs scanner.json --json              # saída em JSON (p/ integrar)
```

**3. Catálogo de manuais** — abra `manuais/index.html`:

- 3 abas: Carros · Motocicletas · Barcos, filtro marca→modelo, busca global
- ✔ LOCAL = PDF já baixado em `manuais/pdfs/`, abre direto e funciona offline
- Demais: abrem no site de origem (ManualPDF.com.br)

## Formato do JSON de scanner

Campos flexíveis (português **ou** inglês):

```json
{
  "vehicle":   { "make": "Fiat", "model": "Siena", "year": 2011, "engine": "1.4" },
  "dtcs":      ["P0171", "P0300"],
  "symptoms":  ["marcha lenta irregular", "consumo alto"],
  "live_data": { "rpm_idle": 620, "stft_b1_percent": 18.5, "ltft_b1_percent": 12.0,
                 "maf_gps_idle": 2.1, "coolant_temp_c": 88, "o2_b1_v": 0.15,
                 "battery_v": 11.9 },
  "notes":     "Falha pior com ar-condicionado ligado."
}
```

Aceitos: `vehicle`/`veiculo` · `dtcs`/`codes`/`codigos` · `symptoms`/`sintomas` ·
`live_data`/`dados_ao_vivo` · `notes`/`observacoes`.

**Dados ao vivo avaliados automaticamente** (status ✓ ok / ⚠ atenção / ✗ problema):

| PID | Interpretação |
|---|---|
| STFT/LTFT (trims) | \|soma\| > 15% = mistura magra/rica crônica (reforça P0171/P0172) |
| RPM de lenta | < 500 = lenta baixa (P0505) · > 900 = lenta alta (P0507) |
| Temperatura (ECT) | > 105°C = superaquecendo (PARE — P0217) · < 75°C quente = termostato preso (P0128) |
| MAF g/s em lenta | fora de 1,5–7 g/s = MAF sub/superestimando (P0101) |
| Sonda O2 B1S1 | preso < 0,2 V ou > 0,8 V = sonda saturada/mistura fixa (P0130) |
| Tensão bateria | < 11,8 V = bateria fraca (códigos aleatórios!) · > 15,2 V = sobrecarga (P0563) |

## Baixar manuais (PDFs reais)

```bash
npm install                    # instala sharp (conversão de imagem p/ PDF)

node tools/baixar-manuais.mjs fiat/siena-2011        # um modelo
node tools/baixar-manuais.mjs fiat volkswagen honda  # marcas inteiras
node tools/baixar-manuais.mjs --tudo                 # TODOS (carros+motos+barcos)
node tools/baixar-manuais.mjs --status               # progresso atual
node tools/baixar-manuais.mjs --limpar-webp          # apaga pastas webp de manuais que já têm PDF
```

Para cada manual: baixa as páginas em alta resolução, monta o **PDF real** em
`manuais/pdfs/{marca}/{modelo}.pdf` e atualiza o índice do catálogo. Assim que o
PDF fica pronto, **as páginas webp são apagadas automaticamente** (o PDF é a
entrega final — economiza ~metade do espaço em disco). Se o PDF falhar, as
páginas ficam em disco com um `leitor.html` offline para retomada. **Retomável** —
interrompa e rode de novo sem perder nada.

> **Volume:** um manual ≈ 5–15 MB. Os 7.400 manuais ≈ 40–70 GB (dias de
> download). A pasta `manuais/pdfs/` é ignorada pelo git.

## Atualizar o catálogo

```bash
node tools/gerar-catalogo.mjs
```

## Estrutura

```
├── index.html                  Agente (web): códigos + JSON scanner + sintomas
├── kb.js                       Base de conhecimento compartilhada (UI + CLI)
│                               ~65 códigos DTC + regras de live data + regras combinadas
├── samples/
│   └── scanner-exemplo.json    Exemplo de entrada do scanner
├── manuais/
│   ├── index.html              Catálogo navegável (3 categorias)
│   ├── catalogo.js             7.400 manuais (gerado)
│   └── pdfs/                   PDFs baixados (ignorado pelo git)
├── tools/
│   ├── diagnostico.mjs         CLI de diagnóstico (usa kb.js)
│   ├── baixar-manuais.mjs      Downloader paralelo com retomada
│   └── gerar-catalogo.mjs      Gera o catálogo de links
└── README.md · LICENSE (MIT) · package.json
```

## 📦 O que mudou na fusão

Os dois repos anteriores tinham abordagens complementares — este unifica tudo:

**Vindo de `car-diagnostics-agent` (CLI Python)** e reformulado:

- ✅ **Entrada JSON de scanner** (`vehicle/dtcs/symptoms/live_data`) → agora na
  UI web **e** na CLI, com parser que aceita nomes em pt/en
- ✅ **Avaliação de dados ao vivo** (trims, temperatura, MAF...) → regras
  reais implementadas em `kb.js` (o protótipo só ecoava os valores)
- ✅ **Amostra de exemplo** (`samples/scanner-exemplo.json`, baseada no Jeep)
- ❌ Descartado: PDFs Toyota (~73 MB) commitados no histórico — material
  com copyright não deve ser versionado; os manuais agora ficam em
  `manuais/pdfs/` (fora do git) e são baixados sob demanda pela ferramenta
- ❌ Descartado: `manuals/external/` (conteúdo copiado de repos de terceiros,
  arquivos soltos de outro projeto) e scripts Python com caminhos temporários
  gravados no código

**Vindo de `agente-diagnostico-dtc`** (base mantida e expandida):

- ✅ Base de conhecimento ~65 códigos (vs 5 do protótipo) com causas rankeadas
- ✅ Interface web com relatório imprimível e busca por sintoma
- ✅ Catálogo de 7.400 manuais (3 categorias) + downloader de PDFs

**Novidades da fusão:**

- ✨ Base de conhecimento **única** (`kb.js`) usada pela web e pela CLI — sem
  lógica duplicada entre linguagens
- ✨ CLI Node substitui o protótipo Python (sem dependências Python)
- ✨ Sugestão automática do manual do veículo no relatório (detecta marca/modelo,
  aponta PDF local ou link para baixar)

## Monitor de e-mails (opcional, máquina local)

O script `tools/monitor-emails.ps1` envia um relatório por e-mail **a cada hora**
(total baixado, páginas, volume em disco, ritmo e **estimativa de término**) e um
e-mail final quando o download dos 7.399 manuais conclui. Se o processo morrer
sem terminar, envia alerta, e também avisa se o disco C: ficar com menos de
15 GB livres (o relatório traz a projeção de espaço no fim do download).

```powershell
# 1) configurar destinatário (arquivo fora do git)
#    tools/monitor-emails.local.json → { "destino": "voce@dominio", "origem": "https://<pages>" }

# 2) ativação única do FormSubmit: rode o script uma vez e clique no link
#    do e-mail "Activate Form" que chega na caixa do destinatário
powershell -ExecutionPolicy Bypass -File tools/monitor-emails.ps1

# 3) agendar execução horária
schtasks /Create /TN "Monitor-Manuais" ^
  /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"<caminho>\tools\monitor-emails.ps1\"" ^
  /SC HOURLY /F
```

Ao concluir, o script envia o e-mail de conclusão e remove a tarefa agendada.
O fim do download é detectado pelo marcador `manuais/pdfs/.concluido` (gravado
pelo downloader ao esgotar a fila); manuais indisponíveis no site de origem
aparecem entre parênteses no e-mail de conclusão.
O envio usa o relé gratuito FormSubmit (sem credenciais); os e-mails chegam
remetidos por formsubmit.co.

## Fontes do conhecimento

Práticas de diagnóstico consolidadas das plataformas **Dicatec** / **Simplo** /
**Doutor-IE** (metodologias: esquema elétrico inteligente, localização de
componentes, torques, sincronismo, tabelas de falhas) + fontes gratuitas
(OBD-codes.com, SMDT Códigos OBD-II, schematics-wiring, AutoZone Repair Guides,
ManualPDF.com.br). Nenhum conteúdo protegido foi copiado.

## Avisos

- ⚠️ Ferramenta de **apoio didático** — confirme sempre na documentação oficial
  da montadora antes de executar reparos. Diagnóstico é **preliminar**.
- 📄 Os PDFs baixados pertencem às montadoras; o site de origem os distribui
  gratuitamente. Use para consulta pessoal na oficina — **não redistribua**.
- ⚠️ Cuidado com "pacotes" de Simplo/Dicatec/Doutor-IE de revendedores: as
  empresas declaram não ter revendedores autorizados.

## Licença

MIT (código). Manuais: © de suas respectivas montadoras.
