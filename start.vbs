' 運営管理アプリ バックグラウンド起動スクリプト
' ウィンドウを表示せずに npm start を実行する

Dim WshShell
Set WshShell = WScript.CreateObject("WScript.Shell")

WshShell.Run "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -Command ""& 'C:\Program Files\nodejs\node.exe' 'C:\Users\turgi\Claude\Projects\運営管理アプリ\server.js'""", 0, False

Set WshShell = Nothing
