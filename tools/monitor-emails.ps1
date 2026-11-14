# ============================================================
# monitor-emails.ps1 — Relatórios por e-mail do download de manuais
#
# Roda a cada 1 hora (tarefa agendada "Monitor-Manuais"):
#   - Lê o progresso (manuais, páginas, bytes) de manuais/pdfs/
#   - Calcula ritmo na última hora e estimativa de término (ETA)
#   - Envia e-mail com o resumo
#   - Quando TERMINA: envia e-mail de conclusão e apaga a tarefa
#   - Se o processo node morrer sem terminar: envia alerta
#
# Destinatário/origem: tools/monitor-emails.local.json (não versionado)
# Envio: FormSubmit (https://formsubmit.co) — precisa de ativação única
# do destinatário (clique no link do e-mail de ativação).
# ============================================================

$ErrorActionPreference = "Continue"
$Root   = Split-Path -Parent $PSScriptRoot
$StateF = Join-Path $PSScriptRoot "monitor-state.json"
$LogF   = Join-Path $PSScriptRoot "monitor-emails.log"
$CfgF   = Join-Path $PSScriptRoot "monitor-emails.local.json"

[System.Threading.Thread]::CurrentThread.CurrentCulture = 'pt-BR'

function Log($msg){
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path $LogF -Value $line -Encoding UTF8
}

# ---------------- config ----------------
if (-not (Test-Path $CfgF)) { Log "✗ config ausente: $CfgF"; exit 1 }
try { $cfg = Get-Content $CfgF -Raw -Encoding UTF8 | ConvertFrom-Json } catch { Log "✗ config inválida: $_"; exit 1 }
$Destino = $cfg.destino
$Origin  = $cfg.origem
if (-not $Destino) { Log "✗ config sem 'destino'"; exit 1 }

# ---------------- progresso ----------------
function Get-Progresso {
  $ind = Join-Path $Root "manuais\pdfs\indice-local.js"
  $manuais = 0; $paginas = 0
  if (Test-Path $ind) {
    try {
      $txt = Get-Content $ind -Raw -Encoding UTF8
      $manuais = ([regex]::Matches($txt, '"marca"\s*:')).Count
      [regex]::Matches($txt, '"paginas"\s*:\s*(\d+)') | ForEach-Object { $paginas += [int]$_.Groups[1].Value }
    } catch { Log "⚠ indice-local.js ilegível (reescrita em curso?): $_" }
  }
  # total de manuais no catálogo (node conta com precisão; caminho absoluto — tarefa roda com CWD do sistema)
  $total = 0
  $catJS = (Join-Path $Root "manuais\catalogo.js") -replace '\\','/'
  if (Test-Path (Join-Path $Root "manuais\catalogo.js")) {
    $nodeCode = "const vm=require('vm'),fs=require('fs');const c={window:{}};vm.runInNewContext(fs.readFileSync('$catJS','utf8'),c);console.log(c.window.CATALOG.categorias.reduce((s,x)=>s+x.marcas.reduce((a,m)=>a+m.modelos.length,0),0))"
    try { $total = [int](& node -e $nodeCode 2>$null) } catch { Log "⚠ catálogo não contado: $_" }
  }
  # bytes (robocopy /L rápido)
  $bytes = 0
  $pdfs = Join-Path $Root "manuais\pdfs"
  if (Test-Path $pdfs) {
    $rc = robocopy $pdfs "$env:TEMP\__nada__" /L /E /NJH /BYTES /XJ /R:0 /W:0 /NFL /NDL /NC /NP 2>$null
    foreach ($l in $rc) {
      if ($l -match 'Bytes\s*:\s*(\d+)') { $bytes = [long]$Matches[1]; break }
    }
  }
  [pscustomobject]@{ manuais=$manuais; paginas=$paginas; bytes=$bytes; total=$total }
}

function Send-Mail($assunto, $mensagem){
  $body = @{
    name     = "Monitor de Manuais"
    message  = $mensagem
    subject  = $assunto
    _captcha = "false"
  } | ConvertTo-Json
  try {
    $r = Invoke-RestMethod -Uri ("https://formsubmit.co/ajax/" + $Destino) -Method Post -ContentType "application/json" -Body $body `
      -Headers @{ Origin = ($Origin -replace '/[^/]*$',''); Referer = $Origin } -TimeoutSec 40
    $ok = ($r.success -eq "true") -or ($r.success -eq $true)
    if ($ok) {
      Log ("enviado: '{0}'" -f $assunto)
      return $true
    } else {
      Log ("rejeitado '{0}': {1}" -f $assunto, ($r | ConvertTo-Json -Compress))
      return $false
    }
  } catch {
    Log "✗ falha no envio ('$assunto'): $($_.Exception.Message)"
    return $false
  }
}

function Fmt-Horas($h){
  if ($h -lt 0 -or $h -gt 100000) { return "?" }
  $tot = [int][math]::Round($h * 60)
  $d = [int][math]::Floor($tot / 1440)
  $hh = [int][math]::Floor(($tot % 1440) / 60)
  $mm = $tot % 60
  if ($d -gt 0) { return "{0}d {1}h" -f $d, $hh }
  if ($hh -gt 0) { return "~{0}h {1}min" -f $hh, $mm }
  return "~{0}min" -f $mm
}

# ---------------- histórico / ritmo ----------------
$hist = @()
if (Test-Path $StateF) { try { $hist = @(Get-Content $StateF -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { $hist = @() } }
$p = Get-Progresso
if ($p.total -le 0) { Log "✗ total de manuais = 0 (catálogo ausente?)"; exit 1 }

$agora  = Get-Date
$amostra = [pscustomobject]@{ ts = $agora.ToString("o"); manuais = $p.manuais; paginas = $p.paginas; bytes = $p.bytes }
$hist = @($hist + $amostra) | Select-Object -Last 48
$hist | ConvertTo-Json -Depth 3 | Set-Content $StateF -Encoding UTF8

# amostra de referência: a mais antiga dentro de ~1h15 (ou a mais antiga que existir)
$ref = $null
foreach ($s in $hist) {
  $ts = [datetime]$s.ts
  if (($agora - $ts).TotalMinutes -ge 60) { $ref = $s; break }   # primeira fora da janela
}
if (-not $ref -and $hist.Count -gt 1) { $ref = $hist[0] }
$dtH = 0
if ($ref) { $dtH = (($agora - [datetime]$ref.ts).TotalMinutes) / 60.0 }
$ritmoM = 0; $ritmoP = 0
if ($ref -and $dtH -gt 0.05) {
  $ritmoM = [math]::Max(0, ($p.manuais - [int]$ref.manuais)) / $dtH
  $ritmoP = [math]::Max(0, ($p.paginas - [int]$ref.paginas)) / $dtH
}
$falta = [math]::Max(0, $p.total - $p.manuais)
$etaH = if ($ritmoM -gt 0.05) { $falta / $ritmoM } else { -1 }
$pct = if ($p.total -gt 0) { [math]::Round(100.0 * $p.manuais / $p.total, 1) } else { 0 }
$gb  = [math]::Round($p.bytes / 1GB, 2)

$nodeOn = ((Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count) -gt 0
$terminou = ($p.manuais -ge $p.total)

# ---------------- estados em um arquivo de flags ----------------
$flagF = Join-Path $PSScriptRoot "monitor-flags.json"
$flags = @{ alertaParado = $false; concluido = $false }
if (Test-Path $flagF) { try { $flags = Get-Content $flagF -Raw -Encoding UTF8 | ConvertFrom-Json } catch { } }

function Monta-Mensagem($tipo){
  $linhas = @()
  $linhas += "RELATORIO DE DOWNLOAD DE MANUAIS (agente-diagnostico-dtc)"
  $linhas += "Tipo: $tipo"
  $linhas += ""
  $linhas += ("Progresso: {0} de {1} manuais ({2}%)" -f $p.manuais, $p.total, $pct)
  $linhas += ("Paginas baixadas: {0:N0}" -f $p.paginas)
  $linhas += ("Volume em disco: {0} GB" -f $gb)
  if ($ritmoM -gt 0.05) {
    $linhas += ("Ritmo (ultima janela ~1h): {0:N0} manuais/h · {1:N0} paginas/h" -f $ritmoM, $ritmoP)
  } else {
    $linhas += "Ritmo: ainda sem amostra de 1 hora completa (primeiro ciclo)"
  }
  if ($etaH -gt 0) {
    $previsao = $agora.AddHours($etaH)
    $linhas += ("Estimativa para terminar: {0} (previsao {1:dd/MM HH:mm})" -f (Fmt-Horas $etaH), $previsao)
  } else {
    $linhas += "Estimativa para terminar: calculando (aguardando amostra de 1h)"
  }
  $linhas += ""
  $linhas += ("Processo de download ativo: {0}" -f ($(if ($nodeOn) { "sim" } else { "NAO" })))
  return ($linhas -join "`r`n")
}

if ($terminou) {
  if (-not $flags.concluido) {
    $msg = Monta-Mensagem "CONCLUSAO"
    Send-Mail ("[Manuais] CONCLUIDO: {0}/{1} manuais" -f $p.manuais, $p.total) $msg | Out-Null
    $flags.concluido = $true
    $flags | ConvertTo-Json | Set-Content $flagF -Encoding UTF8
    schtasks /Delete /TN "Monitor-Manuais" /F 2>$null | Out-Null
    Log "✓ download concluído — e-mail de conclusão enviado e tarefa agendada removida"
  } else {
    Log "✓ já concluído antes (sem novo e-mail)"
  }
  exit 0
}

# download parou sem terminar?
if (-not $nodeOn) {
  if (-not $flags.alertaParado) {
    $ass = "[Manuais] ALERTA: download PAROU em {0}/{1}" -f $p.manuais, $p.total
    Send-Mail $ass (Monta-Mensagem "ALERTA - PROCESSO PARADO") | Out-Null
    $flags.alertaParado = $true
    $flags | ConvertTo-Json | Set-Content $flagF -Encoding UTF8
    Log "⚠ processo node não encontrado — alerta enviado"
  } else {
    Log "⚠ processo parado (alerta já enviado antes)"
  }
  exit 0
} elseif ($flags.alertaParado) {
  $flags.alertaParado = $false
  $flags | ConvertTo-Json | Set-Content $flagF -Encoding UTF8
}

# ---------------- relatório horário normal ----------------
$assunto = ("[Manuais] {0}/{1} ({2}%) · {3} GB" -f $p.manuais, $p.total, $pct, $gb)
if ($etaH -gt 0) { $assunto += " · falta " + (Fmt-Horas $etaH) }
if (Send-Mail $assunto (Monta-Mensagem "RELATORIO HORARIO")) {
  Log ("relatório horário enviado: {0}" -f $assunto)
} else {
  Log ("relatório NÃO entregue (ativação pendente?): {0}" -f $assunto)
}
