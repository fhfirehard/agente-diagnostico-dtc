#!/usr/bin/env node
/**
 * gerar-catalogo.mjs — Gera manuais/catalogo.js a partir do índice público
 * do ManualPDF.com.br (manuais do proprietário, gratuitos).
 *
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
const LIST_URL = `${ORIGIN}/carros-barcos-motos/carros`;
const HEADERS = { "User-Agent": "Mozilla/5.0 (catalogo-manuais-offline)" };
const MAX_PAGES = 10;          // proteção contra loop
const CONCURRENCY = 5;         // requisições simultâneas
const DELAY_MS = 150;

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

// ---- 1) marcas -------------------------------------------------------------
const home = await get(LIST_URL);
const brandSlugs = [...new Set(
  [...home.matchAll(/href="\/carros\/([a-z0-9-]+)\?category=carros-barcos-motos"/g)].map(m => m[1])
)].sort();
if (!brandSlugs.length) {
  console.error("✗ Nenhuma marca encontrada — o site pode ter mudado o layout.");
  process.exit(1);
}
console.log(`✓ ${brandSlugs.length} marcas encontradas`);

// ---- 2) modelos por marca (com paginação) ----------------------------------
async function coletarModelos(slug) {
  const vistos = new Set();
  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1
      ? `${ORIGIN}/carros/${slug}?category=carros-barcos-motos`
      : `${ORIGIN}/carros/${slug}?category=carros-barcos-motos&p=${p}`;
    const html = await get(url);
    const slugs = [...html.matchAll(new RegExp(`href="/${slug}/([a-z0-9-]+)/manual"`, "g"))].map(m => m[1]);
    const novos = slugs.filter(s => !vistos.has(s));
    novos.forEach(s => vistos.add(s));
    if (!novos.length) break;          // página repetida/sem novos → fim
    await sleep(DELAY_MS);
  }
  return [...vistos].sort();
}

async function pool(items, worker) {   // concorrência limitada
  const fila = [...items];
  const jobs = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (fila.length) await worker(fila.shift());
  });
  await Promise.all(jobs);
}

const marcas = [];
let done = 0;
await pool(brandSlugs, async slug => {
  const modelos = await coletarModelos(slug);
  marcas.push({
    slug,
    nome: slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    modelos: modelos.map(s => ({
      slug: s,
      nome: s.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    })),
  });
  done++;
  console.log(`  ${String(done).padStart(2)}/${brandSlugs.length}  ${slug.padEnd(14)} ${modelos.length} manuais`);
});

// ---- 3) grava catálogo -----------------------------------------------------
marcas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
const totalModelos = marcas.reduce((s, m) => s + m.modelos.length, 0);
const out = `// Catálogo de manuais do proprietário — GERADO AUTOMATICAMENTE
// Ferramenta: node tools/gerar-catalogo.mjs  (fonte: índice público ManualPDF.com.br)
// Contém apenas LINKS para as páginas públicas dos manuais.
// Gerado em: ${new Date().toISOString()}

window.CATALOG = {
  fonte: ${JSON.stringify(LIST_URL)},
  gerado_em: ${JSON.stringify(new Date().toLocaleString("pt-BR"))},
  marcas: ${JSON.stringify(marcas, null, 1)}
};
`;
mkdirSync(join(ROOT, "manuais"), { recursive: true });
writeFileSync(join(ROOT, "manuais", "catalogo.js"), out, "utf8");
console.log(`\n✓ manuais/catalogo.js gerado — ${marcas.length} marcas, ${totalModelos} manuais`);
