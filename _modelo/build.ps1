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
#   {{@sep}}                 ", " a partir do 2º item (para listas JSON)

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
        $meta = [pscustomobject]@{ '@num' = ('{0:D2}' -f ($i + 1)); '@sep' = $(if ($i -gt 0) { ', ' } else { '' }) }
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

# robots.txt e sitemap.xml (para o Google encontrar e indexar o site)
$raiz = Split-Path $Saida -Parent
$utf8 = New-Object System.Text.UTF8Encoding $false
[IO.File]::WriteAllText((Join-Path $raiz 'robots.txt'), "User-agent: *`nAllow: /`n`nSitemap: $($dados.site.url)/sitemap.xml`n", $utf8)
$sitemap = "<?xml version=`"1.0`" encoding=`"UTF-8`"?>`n<urlset xmlns=`"http://www.sitemaps.org/schemas/sitemap/0.9`">`n  <url>`n    <loc>$($dados.site.url)/</loc>`n    <lastmod>$(Get-Date -Format 'yyyy-MM-dd')</lastmod>`n  </url>`n</urlset>`n"
[IO.File]::WriteAllText((Join-Path $raiz 'sitemap.xml'), $sitemap, $utf8)
Write-Host "Gerado: robots.txt e sitemap.xml"

# Painel de monitoramento (servido pela VPS em /adm), se o template existir
$tplPainel = Join-Path $PSScriptRoot 'painel.html'
if (Test-Path $tplPainel) {
  $saidaPainel = Join-Path (Split-Path $Saida -Parent) '_servidor\monitor\public\adm.html'
  New-Item -ItemType Directory -Force (Split-Path $saidaPainel -Parent) | Out-Null
  $htmlPainel = Render (Get-Content -LiteralPath $tplPainel -Raw -Encoding UTF8) @($dados)
  [IO.File]::WriteAllText($saidaPainel, $htmlPainel, (New-Object System.Text.UTF8Encoding $false))
  Write-Host "Gerado: $saidaPainel"

  # "App" do painel: ícones (logo sobre o fundo da marca) e manifest para a tela inicial do celular
  Add-Type -AssemblyName System.Drawing
  $pub = Split-Path $saidaPainel -Parent
  $logo = [Drawing.Image]::FromFile((Join-Path (Split-Path $PSScriptRoot -Parent) $dados.marca.logoSimbolo))
  $fundo = [Drawing.ColorTranslator]::FromHtml($dados.cores.fundo)
  foreach ($icone in @(@{ n = 'icone-512.png'; t = 512 }, @{ n = 'icone-192.png'; t = 192 }, @{ n = 'apple-touch-icon.png'; t = 180 })) {
    $t = $icone.t
    $bmp = New-Object Drawing.Bitmap $t, $t
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'
    $g.Clear($fundo)
    # 68% do lado: sobra margem para os cantos arredondados/máscara do Android
    $escala = [Math]::Min($t * 0.68 / $logo.Width, $t * 0.68 / $logo.Height)
    $w = [int]($logo.Width * $escala); $h = [int]($logo.Height * $escala)
    $g.DrawImage($logo, [int](($t - $w) / 2), [int](($t - $h) / 2), $w, $h)
    $g.Dispose()
    $bmp.Save((Join-Path $pub $icone.n), [Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  }
  $logo.Dispose()
  $manifest = [ordered]@{
    name             = "Painel $([char]0xB7) $($dados.marca.nomeCompleto)"
    short_name       = "Painel $($dados.marca.primeiroNome)"
    start_url        = '/adm'
    scope            = '/'
    display          = 'standalone'
    background_color = $dados.cores.fundo
    theme_color      = $dados.cores.principal
    lang             = 'pt-BR'
    icons            = @(
      @{ src = '/icone-192.png'; sizes = '192x192'; type = 'image/png'; purpose = 'any maskable' },
      @{ src = '/icone-512.png'; sizes = '512x512'; type = 'image/png'; purpose = 'any maskable' }
    )
  }
  [IO.File]::WriteAllText((Join-Path $pub 'manifest.webmanifest'), ($manifest | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding $false))
  Write-Host "Gerado: icones e manifest do painel"
}
