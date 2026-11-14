# 🔧 Agente de Diagnóstico DTC + Catálogo de Manuais

Ferramenta **100% offline** para oficinas mecânicas: interpreta códigos de falha
(DTC) de qualquer scanner OBD-II e aponta causas prováveis rankeadas + roteiro de
testes. Inclui catálogo navegável de **manuais do proprietário** (30 marcas,
4.500+ modelos) com **download de PDF** para uso offline.

## Como usar

**Agente de diagnóstico** — abra `index.html` (duplo clique, funciona sem servidor):

1. Cole os códigos do scanner (ex.: `P0171 P0300 U0100`) e clique em **⚡ Interpretar**
2. O agente mostra: título do código, sintomas típicos, **causas ordenadas por
   probabilidade (%)** e **roteiro de testes prático** (multímetro, osciloscópio,
   scanner) — clique nos testes para marcar como feitos
3. Múltiplos códigos são **cruzados** — ex.: `P0128 + P0172` → "termostato preso
   explica a mistura rica; troque o termostato antes de condenar sonda/bicos"
4. Sem código? Use a **busca por sintoma** ("não parte", "trepidação", "consumo alto")
5. **🖨️ Imprimir relatório** gera PDF para o cliente

**Catálogo de manuais** — abra `manuais/index.html`:

- Navegue por marca ou busque marca+modelo
- Links abrem o manual online (ManualPDF.com.br) — **✔ LOCAL** = PDF já baixado,
  abre direto da pasta `manuais/pdfs/` e funciona offline

## Baixar manuais (PDFs reais)

```bash
npm install                    # instala sharp (conversão de imagem p/ PDF)

node tools/baixar-manuais.mjs fiat/siena-2011        # um modelo
node tools/baixar-manuais.mjs fiat volkswagen        # marcas inteiras
node tools/baixar-manuais.mjs fiat --pags 50         # só 50 páginas (teste rápido)
node tools/baixar-manuais.mjs --listar fiat          # lista modelos da marca
```

Para cada manual: baixa as páginas, monta o **PDF real** em
`manuais/pdfs/{marca}/{modelo}.pdf`, gera `leitor.html` offline e atualiza o
índice local do catálogo.

> **Volume:** um manual ≈ 5–15 MB. Uma marca inteira (ex.: Toyota, 385 manuais)
> ≈ 3–5 GB e vários minutos de download. A pasta `manuais/pdfs/` é ignorada pelo
> git por padrão — descomente no `.gitignore` se quiser versionar.

## Atualizar o catálogo

```bash
node tools/gerar-catalogo.mjs
```

Regenera `manuais/catalogo.js` a partir do índice público do ManualPDF.com.br.

## Estrutura

```
├── index.html                 Agente de diagnóstico DTC
├── kb.js                      Base de conhecimento (~65 códigos DTC + macetes)
├── manuais/
│   ├── index.html             Catálogo navegável de manuais
│   ├── catalogo.js            30 marcas · 4.500+ modelos (gerado)
│   └── pdfs/                  PDFs baixados (ignorado pelo git)
├── tools/
│   ├── gerar-catalogo.mjs     Gera o catálogo de links
│   └── baixar-manuais.mjs     Baixa manuais e monta PDFs
└── README.md
```

## Fontes do conhecimento

Práticas de diagnóstico consolidadas das plataformas **Dicatec** / **Simplo** /
**Doutor-IE** (metodologias: esquema elétrico inteligente, localização de
componentes, torques, sincronismo, tabelas de falhas) + fontes gratuitas
(OBD-codes.com, SMDT Códigos OBD-II, schematics-wiring, AutoZone Repair Guides,
ManualPDF.com.br). Nenhum conteúdo protegido foi copiado.

## Avisos

- ⚠️ Ferramenta de **apoio didático** — confirme sempre na documentação oficial
  da montadora antes de executar reparos.
- 📄 Os PDFs baixados pertencem às montadoras; o site de origem os distribui
  gratuitamente. Use para consulta pessoal na oficina — **não redistribua**.
- ⚠️ Cuidado com "pacotes" de Simplo/Dicatec/Doutor-IE de revendedores: as
  empresas declaram não ter revendedores autorizados.

## Licença

MIT (código). Manuais: © de suas respectivas montadoras.
