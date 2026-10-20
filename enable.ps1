# dsh-power-menu 一键启用脚本
#
# 用途：DSH 插件管理器安装后只写 dependencies，不一定会把插件加进
# `dsh.profile.bundles`；少了这一条，宿主半不加载，点按钮就会 HTTP 404。
# 这个脚本只做一件事：把 dsh-power-menu 补进指定 profile 的 bundles，
# 写之前备份 profile 的 package.json。
#
# 用法（在仓库目录右键“使用 PowerShell 运行”，或执行）：
#   powershell -ExecutionPolicy Bypass -File .\enable.ps1
#   powershell -ExecutionPolicy Bypass -File .\enable.ps1 -Profile desktop
# 然后重启 DSH。

param(
  [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'
$pluginName = 'dsh-power-menu'
$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
$pkgPath = Join-Path $profileDir 'package.json'

if (-not (Test-Path $pkgPath)) {
  throw "找不到 DSH profile 的 package.json：$pkgPath"
}

function Get-BundlesMatch($text) {
  $m = [regex]::Match($text, '"bundles"\s*:\s*\[', 'IgnoreCase')
  if (-not $m.Success) { return $null }
  $start = $m.Index + $m.Length
  $depth = 1
  $inString = $false
  $escape = $false
  for ($i = $start; $i -lt $text.Length; $i++) {
    $ch = $text[$i]
    if ($inString) {
      if ($escape) { $escape = $false }
      elseif ($ch -eq [char]92) { $escape = $true }
      elseif ($ch -eq [char]34) { $inString = $false }
    } else {
      if ($ch -eq [char]34) { $inString = $true }
      elseif ($ch -eq [char]91) { $depth++ }
      elseif ($ch -eq [char]93) {
        $depth--
        if ($depth -eq 0) {
          return [pscustomobject]@{
            ContentStart = $start
            CloseIndex = $i
            Content = $text.Substring($start, $i - $start)
          }
        }
      }
    }
  }
  return $null
}

$bytes = [System.IO.File]::ReadAllBytes($pkgPath)
$hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
$raw = [System.IO.File]::ReadAllText($pkgPath, [System.Text.Encoding]::UTF8)

$arrayMatch = Get-BundlesMatch $raw

if ($null -ne $arrayMatch -and $arrayMatch.Content -match '"dsh-power-menu"') {
  Write-Host "[$pluginName] 已经在 dsh.profile.bundles 里。" -ForegroundColor Yellow
  Write-Host "如果按钮仍然 404，请确认 dependencies 里有 $pluginName，并重启 DSH；仍不行就把 profile 的 package.json 和 cordis.yml 发出来。"
} else {
  $newRaw = $null

  if ($null -ne $arrayMatch) {
    $trimmed = $arrayMatch.Content.Trim()
    $insert = if ($trimmed -eq '') {
      '"dsh-power-menu"'
    } else {
      $trimmed.TrimEnd().TrimEnd(',') + ', "dsh-power-menu"'
    }
    $newRaw = $raw.Substring(0, $arrayMatch.ContentStart) + $insert + $raw.Substring($arrayMatch.CloseIndex)
  } else {
    $profileMatch = [regex]::Match($raw, '"profile"\s*:\s*\{', 'IgnoreCase')
    if ($profileMatch.Success) {
      $pos = $profileMatch.Index + $profileMatch.Length
      $newRaw = $raw.Substring(0, $pos) + '"bundles": ["dsh-power-menu"],' + $raw.Substring($pos)
    } else {
      throw "无法在 profile 的 package.json 里定位 dsh.profile；请手动把 $pluginName 加进 dsh.profile.bundles。"
    }
  }

  $backup = "$pkgPath.bak-dsh-power-menu"
  Copy-Item -LiteralPath $pkgPath -Destination $backup -Force
  try {
    [System.IO.File]::WriteAllText($pkgPath, $newRaw, (New-Object System.Text.UTF8Encoding($hasBom)))
    $null = $newRaw | ConvertFrom-Json
    Write-Host "[$pluginName] 已加入 dsh.profile.bundles。" -ForegroundColor Green
    Write-Host "原文件备份：$backup"
    Write-Host "请重启 DSH 让宿主半加载。"
  } catch {
    Copy-Item -LiteralPath $backup -Destination $pkgPath -Force
    throw "写入 bundles 失败，已恢复原文件：$($_.Exception.Message)"
  }
}

# 额外提示：node_modules 里如果还是 junction，说明装的是旧的 link 版本，
# 以后用插件管理器升级时可能报 ERR_PNPM_EPERM（表现为「没有写入权限」）。
$linkTarget = Join-Path $profileDir "node_modules\$pluginName"
if (Test-Path $linkTarget) {
  $item = Get-Item $linkTarget -Force
  if ($item.LinkType -eq 'Junction') {
    Write-Host ''
    Write-Host "[提示] node_modules\$pluginName 目前是 junction（link 安装）。" -ForegroundColor Yellow
    Write-Host "以后从插件管理器升级这个包时可能报「没有写入权限」（pnpm 的 ERR_PNPM_EPERM）。" -ForegroundColor Yellow
    Write-Host "遇到时先删掉这个链接再重装：cmd /c rmdir `"$linkTarget`"" -ForegroundColor Yellow
  }
}
