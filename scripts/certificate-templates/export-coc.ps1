# Safety, Crowd, Crisis and CCMD certificates from the owner's Word files (5 Nov 2026), as PDFs the portal reads on upload.
# In a temporary copy only, the owner's answers: the footer's UBT-PSSR verify line and Safety's hours come off, and the QR opens
# the link printed on the certificate. CCMD has neither a QR nor that line, and is exported as it is.
# The names carry the course code, so Upload Many matches them; the Drive names do not ("STP", "PSCHMBT").
# Make the QR first, from the repo root:
#   node -e "require('qrcode').toFile('qr.png','https://online-appointment.marina.gov.ph/verify-id-oe',{width:600,margin:1,errorCorrectionLevel:'M'})"
# Usage: powershell -ExecutionPolicy Bypass -File scripts/certificate-templates/export-coc.ps1 -Folder <docx folder> -Out <folder> -Qr <qr.png>
param([Parameter(Mandatory)][string]$Folder, [Parameter(Mandatory)][string]$Out, [Parameter(Mandatory)][string]$Qr)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Force $Out | Out-Null
$jobs = @(
  @{ file = "NWMTACI-COC-STP.docx"; code = "STPPDSPPS"; stcw = $true },
  @{ file = "NWMTACI-COC_PSCMT.docx"; code = "PSCMT"; stcw = $true },
  @{ file = "NWMTACI-COC_PSCHMBT.docx"; code = "PSCMHBT"; stcw = $true },
  @{ file = "NWMTACI-COC_CCMD.docx"; code = "CCMD"; stcw = $false }
)
$footerLine = "This can be verified at https://stakeholder.marina.gov.ph/verify-updating-pssr"
function Find-In($range, [string]$text) {
  $r = $range.Duplicate; $f = $r.Find
  $f.ClearFormatting(); $f.Text = $text; $f.MatchCase = $true; $f.Forward = $true; $f.Wrap = 0
  if ($f.Execute()) { return $r }
  return $null
}
# The QR is the only picture in the footer of these Word files, so its size and place on the page stay as they are.
function Set-FooterQr([string]$docx, [string]$png) {
  $zip = [IO.Compression.ZipFile]::Open($docx, "Update")
  try {
    $rels = $zip.GetEntry("word/_rels/footer1.xml.rels")
    if (-not $rels) { throw "$docx has no footer picture" }
    $reader = New-Object IO.StreamReader($rels.Open())
    try { $hits = [regex]::Matches($reader.ReadToEnd(), 'media/[^"]+\.png') } finally { $reader.Dispose() }
    if ($hits.Count -ne 1) { throw "$docx has $($hits.Count) footer pictures, expected the QR only" }
    $name = "word/$($hits[0].Value)"
    $zip.GetEntry($name).Delete()
    $bytes = [IO.File]::ReadAllBytes($png)
    $stream = $zip.CreateEntry($name).Open()
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
  } finally { $zip.Dispose() }
}
$tmp = Join-Path ([IO.Path]::GetTempPath()) "nwm-coc.docx"
$word = New-Object -ComObject Word.Application
$word.Visible = $false; $word.DisplayAlerts = 0
try {
  foreach ($j in $jobs) {
    [IO.File]::Copy((Join-Path $Folder $j.file), $tmp, $true)
    if ($j.stcw) { Set-FooterQr $tmp $Qr }
    $doc = $word.Documents.Open($tmp, $false, $false, $false)
    try {
      if ($j.stcw) {
        $removed = 0
        foreach ($story in $doc.StoryRanges) { $s = $story; while ($s) { $hit = Find-In $s $footerLine; if ($hit) { [void]$hit.Delete(); $removed += 1 }; $s = $s.NextStoryRange } }
        if (-not $removed) { throw "$($j.file): the footer's verify line was not found" }
      }
      # Only Safety has this. Its line stays empty, so the signatures and numbers below sit where they do on Crowd and Crisis.
      $hours = Find-In $doc.Content "(8 Hours)"
      if ($hours) { [void]$hours.Delete() }
      # Page 1 only: the Word files run onto an empty second page.
      $doc.ExportAsFixedFormat([string](Join-Path $Out "$($j.code) - Certificate of Completion.pdf"), 17, $false, 0, 3, 1, 1)
      "$($j.code): exported page 1 of $($doc.ComputeStatistics(2))"
    } finally { $doc.Close([ref]0) }
  }
} finally { $word.Quit([ref]0); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null; Remove-Item $tmp -ErrorAction SilentlyContinue }
