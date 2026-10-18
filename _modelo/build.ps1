# Gera o index.html do site a partir do template + dados da cliente.
#
# Uso (no PowerShell, dentro da pasta do site):
#   powershell -ExecutionPolicy Bypass -File _modelo\build.ps1
#   powershell -ExecutionPolicy Bypass -File _modelo\build.ps1 -Cliente _modelo\outra-cliente.json
#
# Sintaxe do template:
#   {{campo.sub}}            texto (com escape de HTML)
#   {{{campo}}}              HTML cru (para textos com <em>, <br>)
#   {{url:campo}}            valor codificado para URL
#   {{#lista}}...{{/lista}}  repete para cada item (ou mostra o bloco se o valor existir)
#   {{^campo}}...{{/campo}}  mostra o bloco só se o campo estiver vazio
#   {{@num}}                 número do item na lista (01, 02, ...)

param(
  [string]$Cliente = (Join-Path $PSScriptRoot 'cliente.json'),
  [string]$Template = (Join-Path $PSScriptRoot 'template.html'),
  [string]$Saida = (Join-Path (Split-Path $PSScriptRoot -Parent) 'index.html')
)

$ErrorActionPreference = 'Stop'

# Escapa só o necessário, mantendo acentos legíveis no HTML gerado
function Esc([string]$s) { $s.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;') }

$dados = Get-Content -LiteralPath $Cliente -Raw -Encoding UTF8 | ConvertFrom-Json
$tpl = Get-Content -LiteralPath $Template -Raw -Encoding UTF8

# ---------- campos calculados ----------
function UrlEnc([string]$s) { [Uri]::EscapeDataString($s) }

$c = $dados.contato
$waBase = "https://wa.me/$($c.whatsapp)"
$extras = [ordered]@{
  ano          = (Get-Date).Year
  versao       = (Get-Date -Format 'yyyyMMddHHmm')  # força o navegador a baixar CSS/JS novos a cada publicação
  whatsappLink = "$waBase`?text=$(UrlEnc $c.mensagemWhatsapp)"
  whatsappBase = $waBase
  enderecoCompleto = "$($c.endereco), $($c.cidade), CEP $($c.cep)"
  temDepoimentos = (@($dados.depoimentos).Count -gt 0)
}
$extras.mapsLink  = "https://www.google.com/maps/search/?api=1&query=$(UrlEnc $extras.enderecoCompleto)"
$extras.mapsEmbed = "https://www.google.com/maps?q=$(UrlEnc $extras.enderecoCompleto)&output=embed"
$dados | Add-Member -NotePropertyName 'calc' -NotePropertyValue ([pscustomobject]$extras) -Force

# Link de WhatsApp com mensagem específica para cada procedimento
foreach ($p in $dados.procedimentos) {
  $msg = $c.mensagemProcedimento -replace '\{procedimento\}', $p.titulo
  $p | Add-Member -NotePropertyName 'whatsappLink' -NotePropertyValue "$waBase`?text=$(UrlEnc $msg)" -Force
}

# ---------- motor do template ----------
function Resolve-Path2($stack, [string]$path) {
  if ($path -eq '.') { return , $stack[0] }
  foreach ($ctx in $stack) {
    $val = $ctx; $ok = $true
    foreach ($part in $path.Split('.')) {
      if ($null -ne $val -and $val -is [psobject] -and $val.PSObject.Properties[$part]) { $val = $val.$part }
      else { $ok = $false; break }
    }
    if ($ok) { return , $val }  # a vírgula impede o PowerShell de "desembrulhar" listas de 1 item
  }
  return $null
}

function Test-Truthy($v) {
  if ($null -eq $v) { return $false }
  if ($v -is [bool]) { return $v }
  if ($v -is [string]) { return $v.Trim() -ne '' }
  if ($v -is [array]) { return $v.Count -gt 0 }
  return $true
}

function Render([string]$text, $stack) {
  $secRx = [regex]'(?s)\{\{([#^])([\w.]+)\}\}(.*?)\{\{/\2\}\}'
  $text = $secRx.Replace($text, {
    param($m)
    $kind = $m.Groups[1].Value; $val = Resolve-Path2 $stack $m.Groups[2].Value; $inner = $m.Groups[3].Value
    if ($kind -eq '^') { if (Test-Truthy $val) { return '' } else { return (Render $inner $stack) } }
    if (-not (Test-Truthy $val)) { return '' }
    if ($val -is [array]) {
      $sb = New-Object System.Text.StringBuilder
      for ($i = 0; $i -lt $val.Count; $i++) {
        $meta = [pscustomobject]@{ '@num' = ('{0:D2}' -f ($i + 1)) }
        [void]$sb.Append((Render $inner (@($val[$i], $meta) + $stack)))
      }
      return $sb.ToString()
    }
    if ($val -is [psobject] -and -not ($val -is [string])) { return (Render $inner (@($val) + $stack)) }
    return (Render $inner $stack)
  })
  $text = [regex]::Replace($text, '\{\{\{([\w.@]+)\}\}\}', { param($m) [string](Resolve-Path2 $stack $m.Groups[1].Value) })
  $text = [regex]::Replace($text, '\{\{url:([\w.@]+)\}\}', { param($m) UrlEnc ([string](Resolve-Path2 $stack $m.Groups[1].Value)) })
  $text = [regex]::Replace($text, '\{\{([\w.@]+)\}\}', { param($m) Esc ([string](Resolve-Path2 $stack $m.Groups[1].Value)) })
  return $text
}

$html = Render $tpl @($dados)

$restos = [regex]::Matches($html, '\{\{[^}]*\}\}')
if ($restos.Count -gt 0) { Write-Warning ("Marcadores não resolvidos: " + (($restos | ForEach-Object Value | Select-Object -Unique) -join ', ')) }

[IO.File]::WriteAllText($Saida, $html, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Gerado: $Saida ($([math]::Round($html.Length / 1KB)) KB)"

# Painel de monitoramento (painel/index.html), se o template existir
$tplPainel = Join-Path $PSScriptRoot 'painel.html'
if (Test-Path $tplPainel) {
  $saidaPainel = Join-Path (Split-Path $Saida -Parent) 'painel\index.html'
  New-Item -ItemType Directory -Force (Split-Path $saidaPainel -Parent) | Out-Null
  $htmlPainel = Render (Get-Content -LiteralPath $tplPainel -Raw -Encoding UTF8) @($dados)
  [IO.File]::WriteAllText($saidaPainel, $htmlPainel, (New-Object System.Text.UTF8Encoding $false))
  Write-Host "Gerado: $saidaPainel"
}
