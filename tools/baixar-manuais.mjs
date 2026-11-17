#!/usr/bin/env node
/**
 * baixar-manuais.mjs — Baixa manuais do proprietário do ManualPDF.com.br
 * e monta um PDF real localmente (páginas WEBP → JPEG → PDF).
 *
 * O manual é publicado gratuitamente no site de origem; esta ferramenta copia
 * as páginas (imagens públicas do viewer) para uso OFFLINE na sua oficina.
 * Não redistribua — os PDFs pertencem às montadoras.
 *
 * Uso:
 *   node tools/baixar-manuais.mjs fiat/siena-2011         (um manual)
 *   node tools/baixar-manuais.mjs fiat                    (marca inteira)
 *   node tools/baixar-manuais.mjs fiat volkswagen honda   (várias marcas)
 *   node tools/baixar-manuais.mjs --tudo                  (TODOS: carros+motos+barcos)
 *   node tools/baixar-manuais.mjs fiat --pags 50          (teste rápido, 50 páginas)
 *   node tools/baixar-manuais.mjs --listar fiat           (lista modelos)
 *   node tools/baixar-manuais.mjs --status                (progresso atual)
 *
 * Controle de concorrência (env):
 *   MANUALS_CONC=2   manuais em paralelo  (padrão 2)
 *   PAGES_CONC=4     páginas em paralelo  (padrão 4)
 *
 * Retomada: páginas já baixadas são puladas; PDF completo também. Pode
 * interromper (Ctrl+C) e rodar de novo que continua de onde parou.
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTDIR = join(ROOT, "manuais", "pdfs");
const ORIGIN = "https://www.manualpdf.com.br";
const HEADERS = { "User-Agent": "Mozilla/5.0 (baixa-manuais-offline)" };
const LOG = join(OUTDIR, "progresso.log");

const args = process.argv.slice(2);
const F_TUDO = args.includes("--tudo");
const F_STATUS = args.includes("--status");
const F_LISTAR = args.includes("--listar");
const F_FORCAR = args.includes("--forcar");
const pagsIdx = args.indexOf("--pags");
const PAGS = pagsIdx >= 0 ? +args[pagsIdx + 1] : 0;
const alvos = args.filter((a, i) => !a.startsWith("--") && (pagsIdx < 0 || i !== pagsIdx + 1) && a !== String(PAGS));

const CONC_M = +process.env.MANUALS_CONC || 2;   // manuais simultâneos
const CONC_P = +process.env.PAGES_CONC || 4;     // páginas simultâneas

let sharp = null;
try { sharp = (await import("sharp")).default; } catch {
  console.log("ℹ sharp ausente — páginas baixam, mas sem PDF. npm i sharp");
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toLocaleTimeString("pt-BR");
function log(msg) {
  const line = `[${now()}] ${msg}`;
  console.log(line);
  try { mkdirSync(OUTDIR, { recursive: true }); writeFileSync(LOG, readFileSyncSafe(LOG) + line + "\n"); } catch { }
}
function readFileSyncSafe(p) { try { return readFileSync(p, "utf8"); } catch { return ""; } }

async function get(url, asBuf = false) {
  for (let t = 1; t <= 4; t++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.ok) return asBuf ? Buffer.from(await r.arrayBuffer()) : await r.text();
      if (r.status === 404) return null;
    } catch { }
    await sleep(400 * t);
  }
  return null;
}

// ---------------- catálogo local ----------------
function parseCatalogo() {
  const p = join(ROOT, "manuais", "catalogo.js");
  if (!existsSync(p)) { console.error("✗ Rode antes: node tools/gerar-catalogo.mjs"); process.exit(1); }
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(p, "utf8"), ctx);
  return ctx.window.CATALOG;
}

// ---------------- PDF minimalista (imagens JPEG) ----------------
function montaPDF(jpgs, dims) {
  const chunks = [], registry = [];
  let pos = "%PDF-1.4\n".length;
  const header = Buffer.from("%PDF-1.4\n", "binary");
  const wpt = px => Math.round(px * 0.75);
  let nextId = 3;
  const images = jpgs.map((jpg, i) => ({ id: nextId++, jpg, w: dims[i][0], h: dims[i][1], n: i }));
  const kids = [];
  const emit = (id, body) => {
    const bodyBuf = Buffer.isBuffer(body) ? body : (body && body.buf) ? body.buf : Buffer.from(String(body), "binary");
    const full = Buffer.concat([Buffer.from(`${id} 0 obj\n`, "binary"), bodyBuf, Buffer.from("\nendobj\n", "binary")]);
    registry.push({ id, offset: pos });
    pos += full.length;
    chunks.push(full);
  };
  emit(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  for (const img of images) {
    const pageId = nextId++, contentId = nextId++;
    const pw = wpt(img.w), ph = wpt(img.h);
    emit(img.id, { buf: Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpg.length} >>\nstream\n`, "binary"),
      img.jpg, Buffer.from("\nendstream", "binary")
    ]) });
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im${img.n} Do Q`;
    emit(contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    emit(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Contents ${contentId} 0 R /Resources << /XObject << /Im${img.n} ${img.id} 0 R >> >> >>`);
    kids.push(pageId);
  }
  emit(2, `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const total = nextId - 1;
  const xrefStart = pos;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  const map = new Map(registry.map(r => [r.id, r.offset]));
  for (let i = 1; i <= total; i++) xref += String(map.get(i)).padStart(10, "0") + " 00000 n \n";
  const trailer = `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.concat([header, ...chunks, Buffer.from(xref, "binary"), Buffer.from(trailer, "binary")]);
}

// ---------------- índice local (atualizado a cada manual) ----------------
function salvarIndice(locaisMap) {
  const itens = [...locaisMap.values()];
  writeFileSync(join(OUTDIR, "indice-local.js"),
`// GERADO por tools/baixar-manuais.mjs — manuais baixados localmente
window.LOCAIS = ${JSON.stringify({ gerado_em: new Date().toLocaleString("pt-BR"), itens }, null, 1)};
`);
}

function lerIndiceLocal() {
  const p = join(OUTDIR, "indice-local.js");
  if (!existsSync(p)) return new Map();
  const ctx = { window: {} };
  try { vm.runInNewContext(readFileSync(p, "utf8"), ctx); } catch { return new Map(); }
  const m = new Map();
  (ctx.window.LOCAIS?.itens || []).forEach(i => m.set(i.marca + "/" + i.modelo, i));
  return m;
}

// ---------------- limpeza: apagar pastas webp de manuais que já têm PDF ----------------
if (args.includes("--limpar-webp")) {
  const loc = lerIndiceLocal();
  let n = 0, bytes = 0;
  loc.forEach(v => {
    if (!v.pdf) return;
    const d = join(OUTDIR, v.marca, v.modelo);
    if (existsSync(d)) {
      try {
        for (const f of readdirSync(d)) { try { bytes += statSync(join(d, f)).size; } catch { } }
        rmSync(d, { recursive: true, force: true });
        n++;
      } catch { }
    }
  });
  log(`✓ limpeza webp: ${n} pastas removidas · ${(bytes / 1048576).toFixed(0)} MB liberados`);
  process.exit(0);
}

// ---------------- fila ----------------
const cat = parseCatalogo();
const fila = []; // {marca, marcaSlug, modelo, modeloSlug}
const pushManual = (marcaNome, marcaSlug, mod) => fila.push({ marca: marcaNome, marcaSlug, modelo: mod.nome, modeloSlug: mod.slug });

if (F_TUDO) {
  cat.categorias.forEach(c => c.marcas.forEach(m => m.modelos.forEach(x => pushManual(m.nome, m.slug, x))));
} else {
  for (const alvo of alvos) {
    const [b, mod] = alvo.split("/");
    let marca = null;
    for (const c of cat.categorias) { marca = c.marcas.find(x => x.slug === b); if (marca) break; }
    if (!marca) { log(`✗ marca desconhecida: ${b}`); continue; }
    if (mod) {
      let mm = null;
      for (const c of cat.categorias) {
        const mb = c.marcas.find(x => x.slug === b);
        if (mb) { const f = mb.modelos.find(x => x.slug === mod); if (f) { mm = f; break; } }
      }
      if (!mm) { log(`✗ modelo ${mod} não está em ${b}`); continue; }
      pushManual(marca.nome, b, mm);
    } else if (F_LISTAR) {
      console.log(`\n== ${marca.nome} (${marca.modelos.length}) ==`);
      marca.modelos.forEach(x => console.log("  " + x.slug));
    } else {
      marca.modelos.forEach(x => pushManual(marca.nome, b, x));
    }
  }
  if (F_LISTAR) { alvos.forEach(a => { if (a.includes("/")) return; for (const c of cat.categorias) { const m = c.marcas.find(x => x.slug === a); if (m) { console.log(`\n== ${m.nome} (${m.modelos.length}) ==`); m.modelos.forEach(x => console.log("  " + x.slug)); } } }); process.exit(0); }
}
if (F_STATUS) {
  const loc = lerIndiceLocal();
  log(`STATUS: ${loc.size} manuais concluídos de ${fila.length || "catálogo completo (" + cat.categorias.reduce((s, c) => s + c.marcas.reduce((x, m) => x + m.modelos.length, 0), 0) + ")"}`);
  let pags = 0, bytes = 0;
  loc.forEach(v => { pags += v.paginas; });
  log(`páginas baixadas: ${pags}`);
  process.exit(0);
}
if (!fila.length) {
  console.log("Nada na fila. Exemplos:\n  node tools/baixar-manuais.mjs fiat/siena-2011\n  node tools/baixar-manuais.mjs fiat\n  node tools/baixar-manuais.mjs --tudo");
  process.exit(0);
}

// ---------------- download de um manual ----------------
async function pagPool(n, worker) {
  const itens = Array.from({ length: n }, (_, i) => i + 1);
  let idx = 0;
  const jobs = Array.from({ length: Math.min(CONC_P, n) }, async () => {
    while (idx < itens.length) {
      const p = itens[idx++];
      await worker(p);
    }
  });
  await Promise.all(jobs);
}

async function baixarManual(man, done, total, locaisMap) {
  const tag = `[${done + 1}/${total}] ${man.marcaSlug}/${man.modeloSlug}`;
  const dir = join(OUTDIR, man.marcaSlug, man.modeloSlug);
  const pdfPath = join(OUTDIR, man.marcaSlug, man.modeloSlug + ".pdf");

  const html = await get(`${ORIGIN}/${man.marcaSlug}/${man.modeloSlug}/manual`);
  if (!html) { log(`${tag} ✗ página inacessível`); return; }
  const viewer = html.match(/\/viewer\/(\d+)\/(\d+)\/1\/bg1\.webp/);
  if (!viewer) { log(`${tag} ✗ viewer não localizado`); return; }
  const [, vx, vid] = viewer;
  const totalPag = +(html.match(/(\d+)\s*p[áa]ginas/i)?.[1] || 0);
  if (!totalPag) { log(`${tag} ✗ nº de páginas desconhecido`); return; }

  // já completo?
  const prev = locaisMap.get(man.marcaSlug + "/" + man.modeloSlug);
  if (!F_FORCAR && prev && prev.total === (PAGS || totalPag) && (prev.pdf || !sharp)) {
    log(`${tag} ↷ já baixado (${prev.total} páginas) — pulando`);
    done++;
    return;
  }

  mkdirSync(dir, { recursive: true });
  const limite = PAGS || totalPag;
  const jpgs = [], dims = [];
  let faltando = 0;

  await pagPool(limite, async n => {
    const webpFile = join(dir, `pag-${String(n).padStart(3, "0")}.webp`);
    let buf = existsSync(webpFile) ? readFileSync(webpFile) : null;
    if (!buf || buf.length < 500) {
      buf = await get(`${ORIGIN}/viewer/${vx}/${vid}/${n}/large.webp`, true);
      if (!buf || buf.length < 500) { faltando++; return; }
      writeFileSync(webpFile, buf);
      await sleep(30); // polidez
    }
    if (sharp) {
      try {
        const img = sharp(buf);
        const meta = await img.metadata();
        jpgs[n - 1] = await img.jpeg({ quality: 82 }).toBuffer();
        dims[n - 1] = [meta.width, meta.height];
      } catch { faltando++; jpgs[n - 1] = null; }
    }
  });

  const ok = limite - faltando;
  let pdfOk = false;
  if (sharp && jpgs.filter(Boolean).length === limite && !existsSync(pdfPath)) {
    try { writeFileSync(pdfPath, montaPDF(jpgs.filter(Boolean), dims.filter(Boolean))); pdfOk = true; }
    catch (e) { log(`${tag} ⚠ PDF falhou: ${e.message}`); }
  } else if (sharp && existsSync(pdfPath)) pdfOk = true;

  if (pdfOk) {
    // PDF completo = entrega final. Apagar as páginas webp (economiza ~metade do disco).
    try { rmSync(dir, { recursive: true, force: true }); } catch { }
  } else {
    // sem PDF (páginas incompletas/falha): mantém webp p/ retomada + leitor offline
    const pagsHtml = Array.from({ length: limite }, (_, k) =>
      `<img src="pag-${String(k + 1).padStart(3, "0")}.webp" loading="lazy" style="width:100%;max-width:900px;display:block;margin:6px auto;background:#fff">`).join("");
    writeFileSync(join(dir, "leitor.html"),
`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${man.marca} ${man.modelo} — manual (offline)</title>
<style>body{background:#111;color:#eee;font-family:Arial;text-align:center;padding:10px}a{color:#58a6ff}</style></head>
<body><h3>${man.marca} ${man.modelo}</h3><p>${limite} páginas · sem PDF montado · <a href="../..">← catálogo</a></p>
${pagsHtml}</body></html>`);
  }

  if (ok === limite || ok > 0) {
    locaisMap.set(man.marcaSlug + "/" + man.modeloSlug, { marca: man.marcaSlug, modelo: man.modeloSlug, nome: man.modelo, paginas: ok, total: limite, pdf: pdfOk });
    salvarIndice(locaisMap);
  }
  log(`${tag} ✓ ${ok}/${limite} páginas${pdfOk ? " + PDF" : ""}`);
}

// ---------------- execução com workers ----------------
mkdirSync(OUTDIR, { recursive: true });
const locaisMap = lerIndiceLocal();
log(`▶ ${fila.length} manual(is) na fila · concorrência: ${CONC_M} manuais × ${CONC_P} páginas`);

let done = 0;
let idxFila = 0;
async function worker() {
  while (idxFila < fila.length) {
    const man = fila[idxFila++];
    try { await baixarManual(man, done, fila.length, locaisMap); }
    catch (e) { log(`✗ ${man.marcaSlug}/${man.modeloSlug}: ${e.message}`); }
    done++;
    if (done % 25 === 0) {
      let pgs = 0; locaisMap.forEach(v => pgs += v.paginas);
      log(`— progresso: ${done}/${fila.length} manuais · ${pgs} páginas acumuladas`);
    }
  }
}
await Promise.all(Array.from({ length: CONC_M }, worker));
let pgs = 0; locaisMap.forEach(v => pgs += v.paginas);
log(`✓ concluído - ${locaisMap.size} manuais · ${pgs} páginas · índice atualizado`);
// marcador de fim: o monitor de e-mails usa este arquivo para detectar a conclusão
try { writeFileSync(join(OUTDIR, ".concluido"), `${new Date().toISOString()} ${locaisMap.size} manuais\n`); } catch { }
