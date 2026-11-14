#!/usr/bin/env node
/**
 * diagnostico.mjs — CLI do agente de diagnóstico (mesma base kb.js da UI web).
 *
 * Uso:
 *   node tools/diagnostico.mjs samples/scanner-exemplo.json
 *   node tools/diagnostico.mjs --codigos "P0171 P0300 U0100"
 *   node tools/diagnostico.mjs samples/scanner-exemplo.json --json   (saída em JSON)
 *
 * Formato do JSON (flexível, pt/en):
 *   vehicle/veiculo: {make/marca, model/modelo, year/ano, engine/motor}
 *   dtcs/codes/codigos: ["P0300","P0171"]
 *   symptoms/sintomas: ["marcha lenta irregular"]
 *   live_data/dados_ao_vivo: {stft_b1_percent, ltft_b1_percent, rpm_idle,
 *                             coolant_temp_c, maf_gps_idle, o2_b1_v, battery_v}
 *   notes/observacoes: "texto livre"
 */
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const kb = require(join(ROOT, "kb.js"));

const args = process.argv.slice(2);
const F_JSON = args.includes("--json");
const codIdx = args.indexOf("--codigos");
const rest = args.filter(a => !a.startsWith("--") && (codIdx < 0 || a !== args[codIdx + 1]));
const file = rest[0];

const stripTags = s => (s || "").replace(/<[^>]+>/g, "");

// ---------------- análise ----------------
function analisar(scanner){
  const KB = { ...kb.GENERIC_CODES, ...kb.OEM_CODES };
  const found = scanner.codes.filter(c => KB[c]);
  const missing = scanner.codes.filter(c => !KB[c]);
  const live = kb.analisarLiveData(scanner.live);
  const analise = [];
  for (const r of kb.COMBO_RULES) {
    if (r.min) { if (found.length >= r.min) analise.push(r.msg); continue; }
    if (r.al.every(g => g.some(c => found.includes(c)))) analise.push(r.msg);
  }
  if (!analise.length) analise.push("Códigos independentes — trate cada um pela ordem de severidade (críticos primeiro).");
  const cards = found.map(c => ({ codigo: c, ...KB[c] })).sort((a, b) => b.sev - a.sev);
  return { scanner, missing, live, analise: analise.map(stripTags), cards };
}

// manual do proprietário: sugestão a partir do catálogo local (se existir)
function manualSugestao(vehicle){
  const catPath = join(ROOT, "manuais", "catalogo.js");
  if (!existsSync(catPath) || !vehicle.marca) return null;
  try {
    const ctx = { window: {} };
    vm.runInNewContext(readFileSync(catPath, "utf8"), ctx);
    const C = ctx.window.CATALOG;
    const norm = s => (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    for (const cat of C.categorias) {
      const mb = cat.marcas.find(m => m.slug === norm(vehicle.marca) || norm(m.nome) === norm(vehicle.marca));
      if (!mb) continue;
      const q = norm(vehicle.modelo);
      let mod = q ? mb.modelos.find(x => norm(x.nome).includes(q) || q.includes(norm(x.nome))) : null;
      if (!mod && vehicle.ano) mod = mb.modelos.find(x => x.slug.includes(String(vehicle.ano)));
      if (mod) return `${cat.nome}: ${mb.nome} ${mod.nome} → https://www.manualpdf.com.br/${mb.slug}/${mod.slug}/manual`;
      return `${cat.nome}: ver manuais de ${mb.nome} → https://www.manualpdf.com.br/carros-barcos-motos/${cat.slug}`;
    }
  } catch { /* catálogo ausente/corrompido: sem sugestão */ }
  return null;
}

// ---------------- saída em texto ----------------
function texto(r){
  const L = [];
  const bar = p => { const n = Math.round(p / 10); return "█".repeat(n) + "░".repeat(10 - n); };
  const v = r.scanner.vehicle;
  const vdesc = [v.marca, v.modelo, v.ano, v.motor].filter(Boolean).join(" · ");
  L.push("════════════════════════════════════════════════");
  L.push(" 🔧 AGENTE DE DIAGNÓSTICO DTC — relatório");
  L.push("════════════════════════════════════════════════");
  if (vdesc) L.push("Veículo: " + vdesc);
  if (r.scanner.symptoms.length) L.push("Sintomas: " + r.scanner.symptoms.join("; "));
  if (r.scanner.notes) L.push("Notas: " + r.scanner.notes);
  L.push("Códigos: " + (r.scanner.codes.join(", ") || "nenhum"));
  if (r.missing.length) L.push("Não catalogados: " + r.missing.join(", ") + " (consulte a tabela do fabricante)");
  if (r.live.length) {
    L.push("");
    L.push("— Dados ao vivo —");
    for (const o of r.live) {
      const s = o.status === 0 ? "✗" : o.status === 2 ? "⚠" : "✓";
      L.push(` ${s} ${o.regra}: ${o.valor} — ${o.msg}`);
    }
  }
  L.push("");
  L.push("— Análise combinada —");
  r.analise.forEach(a => L.push(" • " + a));
  const sevNome = { 1: "Leve", 2: "Moderada", 3: "CRÍTICA" };
  for (const c of r.cards) {
    const maxW = Math.max(...c.causes.map(x => x.w));
    L.push("");
    L.push(`[${c.codigo}] ${c.t}`);
    L.push(`  Sistema: ${c.s} · Severidade: ${sevNome[c.sev]}`);
    L.push(`  Sintomas típicos: ${c.sym.join(" · ")}`);
    L.push("  Causas prováveis:");
    c.causes.slice().sort((a, b) => b.w - a.w).forEach((x, i) =>
      L.push(`   ${i + 1}. ${bar(Math.round(x.w / maxW * 100))} ${Math.round(x.w / maxW * 100)}%  ${x.c}`));
    L.push("  Roteiro de testes:");
    c.tests.forEach(t => L.push("   ☐ " + t));
  }
  const man = manualSugestao(r.scanner.vehicle);
  if (man) { L.push(""); L.push("— Manual do proprietário —"); L.push(" 📖 " + man); }
  L.push("");
  L.push("⚠ Diagnóstico preliminar — confirme na documentação oficial da montadora.");
  return L.join("\n");
}

// ---------------- saída em JSON ----------------
function saidaJSON(r){
  const man = manualSugestao(r.scanner.vehicle);
  return JSON.stringify({
    vehicle: r.scanner.vehicle,
    symptoms: r.scanner.symptoms,
    notes: r.scanner.notes || undefined,
    codes: r.scanner.codes,
    nao_catalogados: r.missing,
    live_data_avaliado: r.live.map(o => ({
      regra: o.regra, valor: o.valor,
      status: o.status === 1 ? "ok" : o.status === 0 ? "problema" : "atenção",
      msg: o.msg, ref: o.ref
    })),
    analise_combinada: r.analise,
    codigos: r.cards.map(c => ({
      codigo: c.codigo, titulo: c.t, sistema: c.s, severidade: c.sev,
      causas: c.causes.slice().sort((a, b) => b.w - a.w).map(x => ({ causa: x.c, peso: x.w })),
      testes: c.tests
    })),
    manual: man || undefined
  }, null, 2);
}

// ---------------- entrada ----------------
let scanner;
if (codIdx >= 0) {
  scanner = { vehicle: { marca: "", modelo: "", ano: "", motor: "" }, codes: [], symptoms: [], live: {}, notes: "" };
  for (const m of ((args[codIdx + 1] || "")).toUpperCase().matchAll(/\b[PCBU][0-3][0-9A-F]{3}\b/g))
    if (!scanner.codes.includes(m[0])) scanner.codes.push(m[0]);
} else if (file) {
  try {
    scanner = kb.parseScanner(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    console.error("✗ Não consegui ler o JSON: " + e.message);
    process.exit(1);
  }
} else {
  console.log("Agente de diagnóstico DTC — CLI\n");
  console.log("Uso:");
  console.log("  node tools/diagnostico.mjs samples/scanner-exemplo.json");
  console.log("  node tools/diagnostico.mjs --codigos \"P0171 P0300\"");
  console.log("  node tools/diagnostico.mjs <arquivo.json> --json   (saída em JSON)");
  console.log("\nFormato do JSON: vehicle/veiculo, dtcs/codes, symptoms/sintomas,");
  console.log("live_data/dados_ao_vivo, notes/observacoes (pt ou en).");
  process.exit(0);
}

if (!scanner.codes.length && !scanner.symptoms.length) {
  console.error("✗ Nenhum código DTC ou sintoma encontrado. Veja o formato em samples/scanner-exemplo.json");
  process.exit(1);
}

const r = analisar(scanner);
console.log(F_JSON ? saidaJSON(r) : texto(r));
