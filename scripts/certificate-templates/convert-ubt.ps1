# UBT-PSSR certificate from the owner's Word file (NWMTACI-COC (UBT-PSSR).docx, 5 Nov 2026), as convert-stcw.ps1 does for
# Safety, Crowd and Crisis. The sample values are made transparent, so they keep their space but print nothing, and
# the portal writes the real ones in the same place. <key>.measure.pdf keeps them visible, for measuring.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/certificate-templates/convert-ubt.ps1 -Source <docx> -Out <folder>
param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Out)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Out | Out-Null
$key = "UBT-PSSR - Training Certificate"
$tmp = Join-Path ([IO.Path]::GetTempPath()) "nwm-ubt.docx"
[IO.File]::Copy($Source, $tmp, $true)
$word = New-Object -ComObject Word.Application
$word.Visible = $false; $word.DisplayAlerts = 0
function Find-One($text) {
  $r = $doc.Content; $f = $r.Find
  $f.ClearFormatting(); $f.Text = $text; $f.MatchCase = $true; $f.Forward = $true; $f.Wrap = 0
  if (-not $f.Execute()) { throw "Not found in the Word file: $text" }
  return $r
}
try {
  $doc = $word.Documents.Open($tmp, $false, $false, $false)
  try {
    $doc.SaveAs2([ref][string](Join-Path $Out "$key.measure.pdf"), [ref]17)
    $hide = @((Find-One "094-609-000000"), (Find-One "NWMTC22026-176"), (Find-One "TRAINEES NAME"), (Find-One "conducted on May").Paragraphs.Item(1).Range, (Find-One "Issued this").Paragraphs.Item(1).Range)
    foreach ($r in $hide) { $r.Font.Fill.Transparency = 1.0 }
    $doc.SaveAs2([ref][string](Join-Path $Out "$key.pdf"), [ref]17)
    "Pages: $($doc.ComputeStatistics(2))"
  } finally { $doc.Close([ref]0) }
} finally { $word.Quit([ref]0); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null; Remove-Item $tmp -ErrorAction SilentlyContinue }
