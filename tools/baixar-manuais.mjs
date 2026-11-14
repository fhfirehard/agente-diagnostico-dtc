#!/usr/bin/env node
/**
 * baixar-manuais.mjs — Baixa manuais do proprietário do ManualPDF.com.br
 * e monta um PDF real localmente (páginas → WEBP → JPEG → PDF).
 *
 * O manual do site é publicado gratuitamente; esta ferramenta copia as
 * páginas (imagens públicas do viewer) para uso OFFLINE na sua oficina.
 * Não redistribua em outros lugares — os PDFs pertencem às montadoras.
 *
 * Uso:
 *   node tools/baixar-manuais.mjs fiat/siena-2011              (um manual)
 *   node tools/baixar-manuais.mjs fiat                          (marca inteira)
 *   node tools/baixar-manuais.mjs fiat volkswagen byd           (várias marcas)
 *   node tools/baixar-manuais.mjs fiat --pags 50                (só as 50 primeiras páginas, teste)
 *   node tools/baixar-manuais.mjs --listar fiat                 (mostra modelos da marca)
 *
 * Saída:
 *   manuais/pdfs/{marca}/{modelo}/pag-001.webp ...              (páginas originais)
 *   manuais/pdfs/{marca}/{modelo}.pdf                           (PDF montado)
 *   manuais/pdfs/{marca}/{modelo}/leitor.html                   (leitor offline)
 *   manuais/pdfs/indice-local.js                                (índice p/ catálogo)
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTDIR = join(ROOT, "manuais", "pdfs");
const ORIGIN = "https://www.manualpdf.com.br";
const HEADERS = { "User-Agent": "Mozilla/5.0 (baixa-manuais-offline)" };

const args = process.argv.slice(2);
const flags = {
  pags: (() => { const i = args.indexOf("--pags"); return i >= 0 ? +args[i + 1] : 0; })(),
  listar: args.includes("--listar"),
};
const alvos = args.filter(a => !a.startsWith("--") && args[args.indexOf("--pags")] !== a && (args.indexOf("--pags") === -1 || a !== String(flags.pags) || a.includes("/")));

// sharp (opcional para PDF)
let sharp = null;
try { sharp = (await import("sharp")).default; } catch { console.log("ℹ sharp não instalado — PDF não será montado (só páginas webp). npm i sharp p/ PDF."); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, asBuf = false) {
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.ok) return asBuf ? Buffer.from(await r.arrayBuffer()) : await r.text();
      if (r.status === 404) return null;
    } catch { }
    await sleep(500 * t);
  }
  return null;
}

// ---------------- catálogo local (evita refetch se já gerado) ----------------
import { readFileSync } from "node:fs";
import vm from "node:vm";
function parseCatalogo() {
  const p = join(ROOT, "manuais", "catalogo.js");
  if (!existsSync(p)) { console.error("✗ Rode antes: node tools/gerar-catalogo.mjs"); process.exit(1); }
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(p, "utf8"), ctx);
  return ctx.window.CATALOG;
}

// ---------------- resolução de alvos ----------------
const cat = parseCatalogo();
const manuais = []; // {marca, marcaSlug, modelo, modeloSlug}

for (const alvo of alvos) {
  const [b, m] = alvo.split("/");
  const marca = cat.marcas.find(x => x.slug === b);
  if (!marca) { console.log(`✗ marca desconhecida: ${b} (use --listar ${b})`); continue; }
  if (m) {
    const mod = marca.modelos.find(x => x.slug === m);
    if (!mod) { console.log(`✗ modelo ${m} não está em ${b}`); continue; }
    manuais.push({ marca: marca.nome, marcaSlug: b, modelo: mod.nome, modeloSlug: m });
  } else {
    if (flags.listar) { console.log(`\n== ${marca.nome} (${marca.modelos.length}) ==`); marca.modelos.forEach(x => console.log("  " + x.slug)); continue; }
    marca.modelos.forEach(x => manuais.push({ marca: marca.nome, marcaSlug: b, modelo: x.nome, modeloSlug: x.slug }));
  }
}
if (flags.listar && alvos.every(a => !a.includes("/"))) {
  alvos.forEach(a => { const m = cat.marcas.find(x => x.slug === a); if (m) { console.log(`\n== ${m.nome} (${m.modelos.length}) ==`); m.modelos.forEach(x => console.log("  " + x.slug)); } });
  process.exit(0);
}
if (!manuais.length) {
  console.log("Nada a baixar. Exemplos:\n  node tools/baixar-manuais.mjs fiat/siena-2011\n  node tools/baixar-manuais.mjs fiat\n  node tools/baixar-manuais.mjs --listar fiat");
  process.exit(0);
}
console.log(`\n▶ ${manuais.length} manual(is) na fila\n`);

// ---------------- PDF minimalista (imagens JPEG) ----------------
function montaPDF(paginasJpeg, dims) {
  // cada página: [Buffer jpeg, largura, altura]
  let objs = [], offsets = [];
  let out = Buffer.concat([]);
  const push = (buf) => { out = Buffer.concat([out, buf]); };
  const header = Buffer.from("%PDF-1.4\n");
  push(header);
  const addObj = (content) => {
    objs.push(content);
    return objs.length; // id
  };
  // montar depois; primeiro coletar imagens
  const imgIds = [], pageIds = [];
  paginasJpeg.forEach((jpg, i) => {
    const [w, h] = dims[i];
    // stream imagem: não armazenamos offsets exatos antes — recontamos depois
  });
  // Para simplicidade e correção, geramos tudo linearmente:
  const chunks = [];
  const registry = []; // {id, offset}
  let pos = header.length;
  const emit = (id, body) => {
    const bodyBuf = Buffer.isBuffer(body) ? body
      : (body && body.buf) ? body.buf
      : Buffer.from(String(body), "binary");
    const head = Buffer.from(`${id} 0 obj\n`, "binary");
    const tail = Buffer.from("\nendobj\n", "binary");
    const full = Buffer.concat([head, bodyBuf, tail]);
    registry.push({ id, offset: pos });
    pos += full.length;
    chunks.push(full);
  };
  const wpt = px => Math.round(px * 0.75); // 96dpi → 72pt
  const kids = [];
  let nextId = 3; // 1 = catalog, 2 = pages
  const images = [];
  paginasJpeg.forEach((jpg, i) => {
    const [w, h] = dims[i];
    const id = nextId++;
    images.push({ id, jpg, w, h });
  });
  // catálogo
  emit(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  // fontes nenhuma; páginas e imagens
  images.forEach((img, i) => {
    const pageId = nextId++;
    const contentId = nextId++;
    const pw = wpt(img.w), ph = wpt(img.h);
    emit(img.id, { raw: true, buf: Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpg.length} >>\nstream\n`, "binary"),
      img.jpg,
      Buffer.from("\nendstream", "binary")
    ]) });
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im${i} Do Q`;
    emit(contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    emit(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Contents ${contentId} 0 R /Resources << /XObject << /Im${i} ${img.id} 0 R >> >> >>`);
    kids.push(pageId);
  });
  emit(2, `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const total = nextId - 1;
  const xrefStart = pos;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= total; i++) {
    const off = registry.find(r => r.id === i).offset;
    xref += String(off).padStart(10, "0") + " 00000 n \n";
  }
  const trailer = `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.concat([out, ...chunks, Buffer.from(xref, "binary"), Buffer.from(trailer, "binary")]);
}

// ---------------- download de um manual ----------------
async function baixarManual(man, i, total) {
  const tag = `[${i + 1}/${total}] ${man.marcaSlug}/${man.modeloSlug}`;
  const dir = join(OUTDIR, man.marcaSlug, man.modeloSlug);
  const pdfPath = join(OUTDIR, man.marcaSlug, man.modeloSlug + ".pdf");

  const html = await get(`${ORIGIN}/${man.marcaSlug}/${man.modeloSlug}/manual`);
  if (!html) { console.log(`${tag} ✗ página não acessível`); return { ok: false, man }; }

  const viewer = html.match(/\/viewer\/(\d+)\/(\d+)\/1\/bg1\.webp/);
  if (!viewer) { console.log(`${tag} ✗ viewer não localizado`); return { ok: false, man }; }
  const [, vx, vid] = viewer;
  const totalPag = +(html.match(/(\d+)\s*p[áa]ginas/i)?.[1] || 0);
  if (!totalPag) { console.log(`${tag} ✗ nº de páginas não identificado`); return { ok: false, man }; }

  mkdirSync(dir, { recursive: true });
  const limite = flags.pags || totalPag;
  const jpgs = [], dims = [];
  let faltando = 0;

  for (let n = 1; n <= limite; n++) {
    const webpFile = join(dir, `pag-${String(n).padStart(3, "0")}.webp`);
    let buf = existsSync(webpFile) ? readFileSync(webpFile) : await get(`${ORIGIN}/viewer/${vx}/${vid}/${n}/large.webp`, true);
    if (!buf || buf.length < 500) { faltando++; continue; }
    if (!existsSync(webpFile)) writeFileSync(webpFile, buf);
    if (sharp) {
      try {
        const img = sharp(buf);
        const meta = await img.metadata();
        const jpg = await img.jpeg({ quality: 82 }).toBuffer();
        jpgs.push(jpg); dims.push([meta.width, meta.height]);
      } catch { faltando++; }
    }
    process.stdout.write(`\r${tag} página ${n}/${limite}   `);
    await sleep(120);
  }
  process.stdout.write("\n");

  let pdfOk = false;
  if (sharp && jpgs.length && !existsSync(pdfPath)) {
    try {
      writeFileSync(pdfPath, montaPDF(jpgs, dims));
      pdfOk = true;
    } catch (e) { console.log(`${tag} ⚠ PDF falhou: ${e.message}`); }
  }

  // leitor offline
  const pagsHtml = Array.from({ length: limite }, (_, k) =>
    `<img src="pag-${String(k + 1).padStart(3, "0")}.webp" loading="lazy" style="width:100%;max-width:900px;display:block;margin:6px auto;background:#fff">`
  ).join("");
  writeFileSync(join(dir, "leitor.html"),
`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${man.marca} ${man.modelo} — manual (offline)</title>
<style>body{background:#111;color:#eee;font-family:Arial;text-align:center;padding:10px}a{color:#58a6ff}</style></head>
<body><h3>${man.marca} ${man.modelo}</h3><p>${limite} páginas · ${pdfOk ? `PDF: <a href="../${man.modeloSlug}.pdf">abrir/baixar PDF</a>` : "sem PDF montado"} · <a href="../..">← catálogo</a></p>
${pagsHtml}</body></html>`);

  console.log(`${tag} ✓ ${limite - faltando}/${limite} páginas${pdfOk ? " + PDF" : ""}`);
  return { ok: true, man, pags: limite - faltando, total: limite, pdfOk };
}

// ---------------- execução ----------------
mkdirSync(OUTDIR, { recursive: true });
const resultados = [];
for (let i = 0; i < manuais.length; i++) {
  const r = await baixarManual(manuais[i], i, manuais.length);
  resultados.push(r);
  await sleep(300);
}

// índice local p/ catálogo
const locais = resultados.filter(r => r.ok).map(r => ({
  marca: r.man.marcaSlug, modelo: r.man.modeloSlug, nome: r.man.modelo,
  paginas: r.pags, total: r.total, pdf: r.pdfOk
}));
writeFileSync(join(OUTDIR, "indice-local.js"),
`// GERADO por tools/baixar-manuais.mjs — manuais baixados localmente
window.LOCAIS = ${JSON.stringify({ gerado_em: new Date().toLocaleString("pt-BR"), itens: locais }, null, 1)};
`);
console.log(`\n✓ concluído — ${locais.length} manual(is) em manuais/pdfs/ (índice atualizado)`);
