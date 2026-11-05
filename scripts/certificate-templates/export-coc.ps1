# Safety, Crowd and Crisis certificates from the owner's Word files (5 Nov 2026), as PDFs the portal reads on upload.
# In a temporary copy only, the owner's answers: the footer's UBT-PSSR verify line and the course hours come off.
# The names carry the course code, so Upload Many matches them; the Drive names do not ("STP", "PSCHMBT").
# Usage: powershell -ExecutionPolicy Bypass -File scripts/certificate-templates/export-coc.ps1 -Folder <docx folder> -Out <folder>
param([Parameter(Mandatory)][string]$Folder, [Parameter(Mandatory)][string]$Out)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Out | Out-Null
$jobs = @(
  @{ file = "NWMTACI-COC-STP.docx"; code = "STPPDSPPS" },
  @{ file = "NWMTACI-COC_PSCMT.docx"; code = "PSCMT" },
  @{ file = "NWMTACI-COC_PSCHMBT.docx"; code = "PSCMHBT" }
)
$footerLine = "This can be verified at https://stakeholder.marina.gov.ph/verify-updating-pssr"
function Find-In($range, [string]$text) {
  $r = $range.Duplicate; $f = $r.Find
  $f.ClearFormatting(); $f.Text = $text; $f.MatchCase = $true; $f.Forward = $true; $f.Wrap = 0
  if ($f.Execute()) { return $r }
  return $null
}
$tmp = Join-Path ([IO.Path]::GetTempPath()) "nwm-coc.docx"
$word = New-Object -ComObject Word.Application
$word.Visible = $false; $word.DisplayAlerts = 0
try {
  foreach ($j in $jobs) {
    [IO.File]::Copy((Join-Path $Folder $j.file), $tmp, $true)
    $doc = $word.Documents.Open($tmp, $false, $false, $false)
    try {
      $removed = 0
      foreach ($story in $doc.StoryRanges) { $s = $story; while ($s) { $hit = Find-In $s $footerLine; if ($hit) { [void]$hit.Delete(); $removed += 1 }; $s = $s.NextStoryRange } }
      if (-not $removed) { throw "$($j.file): the footer's verify line was not found" }
      # Only Safety has hours. Its line break goes too, so no empty line is left under the course title.
      $hours = Find-In $doc.Content "(8 Hours)"
      if ($hours) { [void]$hours.MoveStart(1, -1); if ($hours.Characters.First.Text -notin @([string][char]11, " ")) { [void]$hours.MoveStart(1, 1) }; [void]$hours.Delete() }
      # Page 1 only: the Word files run onto an empty second page.
      $doc.ExportAsFixedFormat([string](Join-Path $Out "$($j.code) - Certificate of Completion.pdf"), 17, $false, 0, 3, 1, 1)
      "$($j.code): exported page 1 of $($doc.ComputeStatistics(2))"
    } finally { $doc.Close([ref]0) }
  }
} finally { $word.Quit([ref]0); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null; Remove-Item $tmp -ErrorAction SilentlyContinue }
