# dsh-power-menu 一键启用脚本
#
# 用途：DSH 插件管理器安装后只写 dependencies，不一定会把插件加进
# `dsh.profile.bundles`；少了这一条，宿主半不加载，点按钮就会 HTTP 404。
# 这个脚本只做一件事：把 dsh-power-menu 补进 desktop profile 的 bundles，
# 写之前备份 profile 的 package.json。
#
# 用法：在仓库目录右键“使用 PowerShell 运行”，或执行
#   powershell -ExecutionPolicy Bypass -File .\enable.ps1
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

function Ensure-ObjectProperty($object, $name) {
  $property = $object.PSObject.Properties[$name]
  if ($null -eq $property) {
    $object | Add-Member -NotePropertyName $name -NotePropertyValue ([pscustomobject]@{}) -Force
  } elseif ($null -eq $property.Value) {
    $object.$name = [pscustomobject]@{}
  }
  return $object.$name
}

$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$dsh = Ensure-ObjectProperty $pkg 'dsh'
$profileConfig = Ensure-ObjectProperty $dsh 'profile'

if ($null -eq $profileConfig.PSObject.Properties['bundles']) {
  $profileConfig | Add-Member -NotePropertyName bundles -NotePropertyValue @() -Force
}

$bundles = @($profileConfig.bundles)
if ($bundles -notcontains $pluginName) {
  $profileConfig.bundles = @($bundles + $pluginName)
  $backup = "$pkgPath.bak-dsh-power-menu"
  Copy-Item $pkgPath $backup -Force
  $json = $pkg | ConvertTo-Json -Depth 30
  [System.IO.File]::WriteAllText($pkgPath, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "[$pluginName] 已加入 dsh.profile.bundles。" -ForegroundColor Green
  Write-Host "原文件备份：$backup"
  Write-Host "请重启 DSH 让宿主半加载。"
} else {
  Write-Host "[$pluginName] 已经在 dsh.profile.bundles 里。" -ForegroundColor Yellow
  Write-Host "如果按钮仍然 404，请确认 dependencies 里有 $pluginName，并重启 DSH；仍不行就把 profile 的 package.json 和 cordis.yml 发出来。"
}
