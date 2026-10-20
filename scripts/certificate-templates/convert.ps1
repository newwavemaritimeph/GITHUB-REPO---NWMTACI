# Converts New Wave's Word certificate templates (NWMTACI COC - {CODE} - {Name}.docx)
# into PDF templates for the portal (owner, 20 Oct 2026). Needs Microsoft Word and
# the Lucida Bright font on this PC. The originals are never saved.
#
# The text the portal fills in is made fully transparent (white would show over
# the watermark), so it keeps its place but prints nothing: the name, the
# "Conducted ..." paragraph, the "Issued this ..." line and the Certificate /
# Registration No. values. The QR Verify picture stays as the box the portal prints
# the real QR over. Each file gives out/{CODE - Name}.pdf, a .measure.pdf with the
# placeholders visible (same layout) and a .word.json; measure.mjs adds positions.
#
#   powershell -ExecutionPolicy Bypass -File scripts/certificate-templates/convert.ps1 -In <docx folder> -Out <out folder>
param([Parameter(Mandatory)][string]$In, [Parameter(Mandatory)][string]$Out, [switch]$Force)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Out | Out-Null
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

function Find-All($story, [string]$text) {
  $hits = @()
  $r = $story.Duplicate
  $f = $r.Find
  $f.ClearFormatting(); $f.Text = $text; $f.MatchWildcards = $false; $f.MatchCase = $true; $f.Forward = $true; $f.Wrap = 0
  $last = -1
  # Stops if Word does not move past the last match (a match at the very end of a story).
  while ($hits.Count -lt 50 -and $f.Execute() -and $r.Start -gt $last) { $last = $r.Start; $hits += $r.Duplicate; $r.Collapse(0) }
  return $hits
}
# Collected, then made transparent after the measuring copy is saved (transparent text is left out of the PDF).
function Hide($range) { $script:toHide += $range }

$done = 0; $failed = @()
$tmp = Join-Path ([IO.Path]::GetTempPath()) "nwm-coc.docx"
try {
  foreach ($file in Get-ChildItem $In -Filter "NWMTACI COC - *.docx") {
    $parts = $file.BaseName -split " - ", 3
    if ($parts.Count -lt 3) { $failed += "$($file.Name): name is not 'NWMTACI COC - CODE - Name'"; continue }
    $code = $parts[1].Trim()
    # Named by code and course: the 27 ILO catering templates share the code ILO.
    $key = ($code + " - " + $parts[2].Trim()) -replace '[\/:*?"<>|]', '_'
    $pdf = [string](Join-Path $Out "$key.pdf")
    if (-not $Force -and (Test-Path $pdf)) { $done++; continue }
    $doc = $null
    try {
      # Word cannot open paths over ~255 characters, so it opens a short-named copy.
      [IO.File]::Copy("\\?\" + $file.FullName, $tmp, $true)
      $doc = $word.Documents.Open($tmp, $false, $true, $false)
      if (-not $doc) { throw "Word could not open the file." }
      $script:toHide = @()
      $info = [ordered]@{ code = $code; file = $file.Name; course = $parts[2].Trim(); conducted = $null; issued = $null; name = $null; qr = $null }
      $body = $doc.Content
      # The training-dates paragraph, recorded with its placeholders, then hidden.
      foreach ($ph in @("[START DATE]", "[DATE]")) {
        $hit = Find-All $body $ph | Select-Object -First 1
        if ($hit -and -not $info.conducted) {
          $p = $hit.Paragraphs.Item(1)
          $info.conducted = @{ text = $p.Range.Text.Trim(); align = $p.Alignment; size = $p.Range.Font.Size }
          Hide $p.Range
        }
      }
      $hit = Find-All $body "Issued this" | Select-Object -First 1
      if ($hit) { $p = $hit.Paragraphs.Item(1); $info.issued = @{ text = $p.Range.Text.Trim(); align = $p.Alignment; size = $p.Range.Font.Size }; Hide $p.Range }
      $hit = Find-All $body "[TRAINEE FULL NAME]" | Select-Object -First 1
      if ($hit) { $info.name = @{ size = $hit.Font.Size; bold = [bool]$hit.Font.Bold; align = $hit.Paragraphs.Item(1).Alignment } }
      # Placeholders anywhere (body, headers, footers, text boxes).
      foreach ($story in $doc.StoryRanges) {
        $s = $story
        while ($s) {
          foreach ($ph in @("[TRAINEE FULL NAME]", "[CERTIFICATE NO.]", "[REGISTRATION NO.]", "[DATE]", "[START DATE]", "[END DATE]")) { foreach ($h in (Find-All $s $ph)) { Hide $h } }
          $s = $s.NextStoryRange
        }
      }
      foreach ($sec in $doc.Sections) { foreach ($i in 1..3) { foreach ($sh in $sec.Headers.Item($i).Shapes) { if ($sh.Name -eq "QR Verify") { $info.qr = @{ w = $sh.Width; h = $sh.Height } } } } }
      # The .measure.pdf keeps the placeholders visible so measure.mjs can find them; same layout.
      $doc.SaveAs2([ref][string](Join-Path $Out "$key.measure.pdf"), [ref]17)
      foreach ($r in $script:toHide) { $r.Font.Fill.Transparency = 1.0 }
      $doc.SaveAs2([ref]$pdf, [ref]17)
      ($info | ConvertTo-Json -Depth 5) | Set-Content -Encoding UTF8 (Join-Path $Out "$key.word.json")
      $done++
    } catch { $failed += "$($file.Name) (line $($_.InvocationInfo.ScriptLineNumber)): $($_.Exception.Message)" } finally { if ($doc) { $doc.Close([ref]0) } }
  }
} finally { $word.Quit([ref]0); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null }
"Converted $done"
if ($failed.Count) { "Failed:"; $failed }
