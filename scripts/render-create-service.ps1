# Requires: Render CLI already logged in (token in %USERPROFILE%\.render)
$ErrorActionPreference = 'Stop'
$renderExe = Join-Path $env:LOCALAPPDATA 'render-cli\cli_v1.1.0.exe'

function Get-RenderToken {
  $cfg = Join-Path $env:USERPROFILE '.render\cli.yaml'
  if (-not (Test-Path $cfg)) { throw 'Not logged in to Render. Run render login first.' }
  $raw = Get-Content $cfg -Raw
  if ($raw -match 'apiKey:\s*(\S+)') { return $Matches[1] }
  if ($raw -match 'token:\s*(\S+)') { return $Matches[1] }
  if ($raw -match 'cliToken:\s*(\S+)') { return $Matches[1] }
  # YAML may nest under key
  if ($raw -match '(?m)^\s*(?:api[_-]?key|token|cli[_-]?token):\s*"?([^"\r\n]+)"?') {
    return $Matches[1].Trim()
  }
  throw "Could not parse Render token from $cfg"
}

function Invoke-RenderApi($Method, $Path, $Body = $null) {
  $token = Get-RenderToken
  $headers = @{
    Authorization = "Bearer $token"
    Accept        = 'application/json'
  }
  $params = @{
    Method  = $Method
    Uri     = "https://api.render.com/v1$Path"
    Headers = $headers
  }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json'
    $params.Body = ($Body | ConvertTo-Json -Depth 8)
  }
  return Invoke-RestMethod @params
}

Write-Output 'Checking Render auth...'
$who = & $renderExe whoami -o json 2>$null
if (-not $who) { throw 'render whoami failed — login first' }
Write-Output $who

$owners = Invoke-RenderApi GET '/owners'
$ownerId = $null
if ($owners -is [Array]) {
  $ownerId = $owners[0].owner.id
  if (-not $ownerId) { $ownerId = $owners[0].id }
} else {
  $ownerId = $owners[0].owner.id
}
# owners endpoint returns [{owner:{id,...}, cursor}]
if (-not $ownerId) {
  $parsed = $owners | ConvertTo-Json -Depth 6 | ConvertFrom-Json
  $ownerId = $parsed[0].owner.id
}
Write-Output "ownerId=$ownerId"

$name = 'diu-english-smartroutine'
$repo = 'https://github.com/Ooli-1927/diu-english-smartroutine'
$jwt = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })

$body = @{
  type    = 'web_service'
  name    = $name
  ownerId = $ownerId
  repo    = $repo
  branch  = 'main'
  autoDeploy = 'yes'
  serviceDetails = @{
    runtime     = 'node'
    plan        = 'free'
    region      = 'singapore'
    buildCommand = 'bash ./scripts/render-build.sh'
    startCommand = 'npm --prefix backend start'
    healthCheckPath = '/api/health'
    numInstances = 1
  }
  envVars = @(
    @{ key = 'NODE_VERSION'; value = '22.14.0' },
    @{ key = 'JWT_SECRET'; value = $jwt },
    @{ key = 'CORS_ORIGIN'; value = '*' },
    @{ key = 'WEB_DIST'; value = 'backend/public' }
  )
}

Write-Output 'Creating Web Service...'
try {
  $created = Invoke-RenderApi POST '/services' $body
  $created | ConvertTo-Json -Depth 6
  $svcId = $created.service.id
  $url = $created.service.serviceDetails.url
  if (-not $url) { $url = $created.service.url }
  Write-Output "CREATED id=$svcId url=$url"
} catch {
  Write-Output "Create failed: $($_.Exception.Message)"
  if ($_.ErrorDetails.Message) { Write-Output $_.ErrorDetails.Message }
  # Maybe already exists — list and redeploy
  $list = Invoke-RenderApi GET '/services?limit=50'
  $list | ConvertTo-Json -Depth 5 | Out-File "$env:TEMP\render-services.json" -Encoding utf8
  Write-Output 'Listed services to TEMP\render-services.json'
  throw
}
