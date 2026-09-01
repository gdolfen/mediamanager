# Startet den MediaManager-Server IMMER mit der Produktions-Datenbank unter lokal\data
# und den in der DB gespeicherten Zielpfaden (P:\ upload, Y:\ fotos, V:\ videos).
# PowerShell-Env persistiert NICHT zwischen Aufrufen – nur so bleibt DATA_DIR korrekt.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $Root 'lokal\server.pid'
$OutLog = Join-Path $Root 'lokal\server.out.log'
$ErrLog = Join-Path $Root 'lokal\server.err.log'

if (Test-Path $PidFile) {
  $old = Get-Content $PidFile | Select-Object -First 1
  if ($old -and $old -match '^\d+$') {
    Stop-Process -Id ([int]$old) -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

# Zielpfade aus der DB lesen (werden beim Start nur zum Seed benötigt)
$DbPath = Join-Path $Root 'lokal\data\mediamanager.db'
$settingsJson = node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1],{readOnly:true});const rows=db.prepare('SELECT key,value FROM settings').all();const o={};for(const r of rows)o[r.key]=r.value;console.log(JSON.stringify(o));" $DbPath
$settings = $settingsJson | ConvertFrom-Json

$env:PORT = '4000'
$env:DATA_DIR = Join-Path $Root 'lokal\data'
$env:UPLOAD_DIR = $settings.'paths.upload'
$env:FOTOS_DIR = $settings.'paths.fotos'
$env:VIDEOS_DIR = $settings.'paths.videos'

Remove-Item $OutLog, $ErrLog -Force -ErrorAction SilentlyContinue
$proc = Start-Process -FilePath 'node' -ArgumentList 'backend/dist/index.js' -WorkingDirectory $Root -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog -PassThru -NoNewWindow
$proc.Id | Set-Content $PidFile
Write-Output "Server gestartet (PID $($proc.Id)) DATA_DIR=$($env:DATA_DIR) upload=$($env:UPLOAD_DIR) fotos=$($env:FOTOS_DIR) videos=$($env:VIDEOS_DIR)"