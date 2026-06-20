$src = "C:\Users\turgi\Claude\Projects\運営管理アプリ\start.vbs"
$startup = [Environment]::GetFolderPath("Startup")
$dst = Join-Path $startup "uneiApp.vbs"

Copy-Item -Path $src -Destination $dst -Force

if (Test-Path $dst) {
    Write-Host "登録完了: $dst"
} else {
    Write-Host "失敗しました"
}
Read-Host "Enterキーで閉じる"
