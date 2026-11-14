#!/usr/bin/env node
/**
 * gerar-catalogo.mjs — Gera manuais/catalogo.js a partir do índice público
 * do ManualPDF.com.br (manuais do proprietário, gratuitos).
 *
 * Categorias: carros, motocicletas e barcos.
 * O catálogo contém APENAS links (marca/modelo → página pública do manual).
 * Nenhum conteúdo dos manuais é copiado — os PDFs pertencem às montadoras
 * e são servidos pelo próprio site de origem.
 *
 * Uso:  node tools/gerar-catalogo.mjs
 * Saída: manuais/catalogo.js  (window.CATALOG = {...})
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://www.manualpdf.com.br";
const HEADERS = { "User-Agent": "Mozilla/5.0 (catalogo-manuais-offline)" };
const MAX_PAGES = 15;          // proteção contra loop
const CONCURRENCY = 5;         // requisições simultâneas
const DELAY_MS = 120;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  for (let tent = 1; tent <= 3; tent++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.ok) return await r.text();
    } catch { /* retry */ }
    await sleep(400 * tent);
  }
  return "";
}

// Categorias: como LISTAR marcas e como montar o link de manual.
// carros:    lista em /carros/{marca},            manual em /{marca}/{slug}/manual
// motos:     lista em /motocicletas/{marca},      manual em /{marca}/{slug}/manual
// barcos:    lista em /barcos/{marca},            manual em /{marca}/{slug}/manual
const CATS = [
  { slug: "carros",       nome: "Carros",       listar: "carros" },
  { slug: "motocicletas", nome: "Motocicletas", listar: "motocicletas" },
  { slug: "barcos",       nome: "Barcos",       listar: "barcos" },
];

async function marcasDaCategoria(cat) {
  const slug = cat.listar;
  const home = await get(`${ORIGIN}/carros-barcos-motos/${slug}`);
  const found = [...new Set(
    [...home.matchAll(new RegExp(`href="/${slug}/([a-z0-9-]+)\\?category=carros-barcos-motos"`, "g"))].map(m => m[1])
  )].sort();
  return found;
}

async function coletarModelos(cat, brandSlug) {
  const prefix = cat.listar;                    // /motocicletas/honda?...&p=2
  const vistos = new Set();
  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1
      ? `${ORIGIN}/${prefix}/${brandSlug}?category=carros-barcos-motos`
      : `${ORIGIN}/${prefix}/${brandSlug}?category=carros-barcos-motos&p=${p}`;
    const html = await get(url);
    // manual sempre em /{marca}/{modelo}/manual (sem prefixo de categoria)
    const slugs = [...html.matchAll(new RegExp(`href="/${brandSlug}/([a-z0-9-]+)/manual"`, "g"))].map(m => m[1]);
    const novos = slugs.filter(s => !vistos.has(s));
    novos.forEach(s => vistos.add(s));
    if (!novos.length) break;
    await sleep(DELAY_MS);
  }
  return [...vistos].sort();
}

async function pool(items, worker) {
  const fila = [...items];
  const jobs = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (fila.length) await worker(fila.shift());
  });
  await Promise.all(jobs);
}

// ---- execução --------------------------------------------------------------
const categorias = [];
for (const cat of CATS) {
  const slugs = await marcasDaCategoria(cat);
  if (!slugs.length) { console.log(`⚠ ${cat.slug}: nenhuma marca encontrada`); continue; }
  console.log(`▶ ${cat.nome}: ${slugs.length} marcas`);
  const marcas = [];
  let done = 0;
  await pool(slugs, async slug => {
    const modelos = await coletarModelos(cat, slug);
    marcas.push({
      slug,
      nome: slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      modelos: modelos.map(s => ({
        slug: s,
        nome: s.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      })),
    });
    done++;
    console.log(`   ${String(done).padStart(2)}/${slugs.length}  ${slug.padEnd(16)} ${modelos.length} manuais`);
  });
  marcas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  categorias.push({ slug: cat.slug, nome: cat.nome, marcas });
}

const totalModelos = categorias.reduce((s, c) => s + c.marcas.reduce((x, m) => x + m.modelos.length, 0), 0);
const out = `// Catálogo de manuais do proprietário — GERADO AUTOMATICAMENTE
// Ferramenta: node tools/gerar-catalogo.mjs  (fonte: índice público ManualPDF.com.br)
// Contém apenas LINKS para as páginas públicas dos manuais.
// Gerado em: ${new Date().toISOString()}

window.CATALOG = {
  fonte: ${JSON.stringify(ORIGIN)},
  gerado_em: ${JSON.stringify(new Date().toLocaleString("pt-BR"))},
  categorias: ${JSON.stringify(categorias, null, 1)}
};
`;
mkdirSync(join(ROOT, "manuais"), { recursive: true });
writeFileSync(join(ROOT, "manuais", "catalogo.js"), out, "utf8");
console.log(`\n✓ manuais/catalogo.js gerado — ${totalModelos} manuais em ${categorias.length} categorias`);
