# Usage: powershell -ExecutionPolicy Bypass -File scripts/certificate-templates/convert-stcw.ps1 -Out <folder>   (reads Safety.docx, Crowd Management.docx, Crisis Management.docx from the Desktop)
# MARINA-style STCW certificate templates (Safety, Crowd, Crisis; owner 20 Oct 2026).
# The blanks get placeholders the portal fills: [START DATE] [END DATE] [ASSESS DATE] [ISSUE DATE].
# The name, numbers, issue date and the "Conducted" paragraph are made transparent; the
# "Trainee Photo" picture stays as the box the 2x2 photo is printed over.
param([Parameter(Mandatory)][string]$Out)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Out | Out-Null
$desk = Join-Path $env:USERPROFILE "Desktop"
$jobs = @(
  @{ file = "Safety.docx"; code = "STPPDSPPS"; key = "STPPDSPPS - Safety" },
  @{ file = "Crowd Management.docx"; code = "PSCMT"; key = "PSCMT - Crowd Management" },
  @{ file = "Crisis Management.docx"; code = "PSCMHBT"; key = "PSCMHBT - Crisis Management" }
)
$word = New-Object -ComObject Word.Application
$word.Visible = $false; $word.DisplayAlerts = 0
function Find-All($story, [string]$text, [bool]$wild = $false) {
  $hits = @(); $r = $story.Duplicate; $f = $r.Find
  $f.ClearFormatting(); $f.Text = $text; $f.MatchWildcards = $wild; $f.MatchCase = $true; $f.Forward = $true; $f.Wrap = 0
  $last = -1
  while ($hits.Count -lt 50 -and $f.Execute() -and $r.Start -gt $last) { $last = $r.Start; $hits += $r.Duplicate; $r.Collapse(0) }
  return $hits
}
$tmp = Join-Path ([IO.Path]::GetTempPath()) "nwm-stcw.docx"
try {
  foreach ($j in $jobs) {
    [IO.File]::Copy((Join-Path $desk $j.file), $tmp, $true)
    $doc = $word.Documents.Open($tmp, $false, $false, $false)
    try {
      $body = $doc.Content
      $conducted = (Find-All $body "Conducted " | Select-Object -First 1).Paragraphs.Item(1)
      $blanks = Find-All $conducted.Range "_{5,}" $true
      $names = if ($blanks.Count -ge 3) { @("[START DATE]", "[END DATE]", "[ASSESS DATE]") } else { @("[START DATE]", "[ASSESS DATE]") }
      # Replace from the end so earlier ranges stay valid.
      for ($i = $blanks.Count - 1; $i -ge 0; $i--) { $blanks[$i].Text = $names[$i] }
      $conducted = (Find-All $doc.Content "Conducted " | Select-Object -First 1).Paragraphs.Item(1)
      $issue = Find-All $doc.Content "Date of Issue:" | Select-Object -First 1
      $issue.InsertAfter(" [ISSUE DATE]")
      $name = Find-All $doc.Content "[TRAINEE FULL NAME]" | Select-Object -First 1
      $info = [ordered]@{ code = $j.code; file = $j.file; conducted = @{ text = $conducted.Range.Text.Trim(); align = $conducted.Alignment; size = $conducted.Range.Font.Size }; name = @{ size = $name.Font.Size; bold = [bool]$name.Font.Bold }; photo = $null }
      foreach ($sh in $doc.Shapes) { if ($sh.Name -eq "Trainee Photo") { $info.photo = @{ w = $sh.Width; h = $sh.Height } } }
      foreach ($sec in $doc.Sections) { foreach ($k in 1..3) { foreach ($sh in $sec.Headers.Item($k).Shapes) { if ($sh.Name -eq "Trainee Photo") { $info.photo = @{ w = $sh.Width; h = $sh.Height } } } } }
      if (-not $info.photo) { foreach ($ish in $doc.InlineShapes) { if ($ish.AlternativeText -match "photo" -or $ish.Title -match "Photo") { $info.photo = @{ w = $ish.Width; h = $ish.Height } } } }
      $doc.SaveAs2([ref][string](Join-Path $Out "$($j.key).measure.pdf"), [ref]17)
      $hide = @($conducted.Range)
      foreach ($story in $doc.StoryRanges) { $s = $story; while ($s) { foreach ($ph in @("[TRAINEE FULL NAME]", "[CERTIFICATE NO.]", "[REGISTRATION NO.]", "[ISSUE DATE]")) { $hide += (Find-All $s $ph) }; $s = $s.NextStoryRange } }
      foreach ($r in $hide) { $r.Font.Fill.Transparency = 1.0 }
      $doc.SaveAs2([ref][string](Join-Path $Out "$($j.key).pdf"), [ref]17)
      ($info | ConvertTo-Json -Depth 5) | Set-Content -Encoding UTF8 (Join-Path $Out "$($j.key).word.json")
      "Converted $($j.key)"
    } finally { $doc.Close([ref]0) }
  }
} finally { $word.Quit([ref]0); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null }
