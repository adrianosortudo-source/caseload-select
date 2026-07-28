[CmdletBinding()]
param(
  [ValidateSet("preflight", "preview", "promote")]
  [string]$Mode = "preflight",
  [string]$BaselineSha,
  [string]$PreviewUrl,
  [switch]$DatabaseMigrationConfirmed,
  [switch]$VisualQAConfirmed
)

$ErrorActionPreference = "Stop"

function Stop-Release([string]$Message) {
  throw "PORTAL RELEASE BLOCKED: $Message"
}

function Invoke-Git([string[]]$Arguments) {
  $result = & git @Arguments
  if ($LASTEXITCODE -ne 0) {
    Stop-Release "Git command failed: git $($Arguments -join ' ')"
  }
  return $result
}

function Get-VercelToken {
  $tokenFile = if ($env:CASELOAD_VERCEL_TOKEN_FILE) {
    $env:CASELOAD_VERCEL_TOKEN_FILE
  } else {
    "C:\Users\adria\.vercel-tokens\old.txt"
  }
  if (-not (Test-Path -LiteralPath $tokenFile)) {
    Stop-Release "Vercel token file is unavailable. Set CASELOAD_VERCEL_TOKEN_FILE."
  }
  return (Get-Content -LiteralPath $tokenFile -Raw).Trim()
}

function Assert-CommitAuthorCanDeploy([string]$Token) {
  $commitAuthor = (Invoke-Git @("log", "-1", "--format=%ae")).Trim()
  try {
    $account = Invoke-RestMethod -Headers @{ Authorization = "Bearer $Token" } -Uri "https://api.vercel.com/v2/user"
  } catch {
    Stop-Release "Could not verify the Vercel deployment account for the release commit author check."
  }
  if (-not $account.user.email -or $account.user.email -ne $commitAuthor) {
    Stop-Release "Commit author '$commitAuthor' differs from the authenticated Vercel deployment account. Re-author the release commit with the deployment account, or use a token owned by that author, before creating a preview."
  }
}

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repositoryRoot
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot "portal-release.config.json") -Raw | ConvertFrom-Json

# A production release must always be an immutable, complete repository snapshot.
$dirty = @(Invoke-Git @("status", "--porcelain"))
if ($dirty.Count -gt 0) {
  Stop-Release "Working tree is dirty. Commit or discard every intended change before releasing; never deploy selected files from a partial worktree."
}

$headSha = (Invoke-Git @("rev-parse", "HEAD")).Trim()
$branch = (Invoke-Git @("branch", "--show-current")).Trim()
if (-not $branch) {
  Stop-Release "Detached HEAD is not a release source. Create the release from an approved branch."
}

if ($BaselineSha) {
  Invoke-Git @("cat-file", "-e", "$BaselineSha^{commit}") | Out-Null
  & git merge-base --is-ancestor $BaselineSha $headSha
  if ($LASTEXITCODE -ne 0) {
    Stop-Release "Baseline SHA is not an ancestor of this release candidate."
  }
}

$changedFiles = @()
if ($BaselineSha) {
  $changedFiles = @(Invoke-Git @("diff", "--name-only", "$BaselineSha..$headSha"))
  $hasMigration = $changedFiles | Where-Object { $_ -like "supabase/migrations/*" }
  if ($hasMigration -and -not $DatabaseMigrationConfirmed) {
    Stop-Release "This release contains a database migration. Apply and verify it first, then rerun with -DatabaseMigrationConfirmed."
  }
}

Write-Host "Release candidate: $headSha on $branch"
Write-Host "Target project: $($config.projectName) / $($config.scope)"
if ($BaselineSha) { Write-Host "Baseline: $BaselineSha" }

if ($Mode -eq "preflight") {
  Write-Host "PASS: clean, complete release candidate. Preview has not been deployed."
  exit 0
}

if ($Mode -eq "preview") {
  if (-not $BaselineSha) {
    Stop-Release "Preview requires -BaselineSha so migrations are explicitly checked."
  }
  $token = Get-VercelToken
  Assert-CommitAuthorCanDeploy $token
  Write-Host "Deploying preview. Production promotion remains blocked until visual QA is confirmed."
  & npx.cmd --yes "vercel@$($config.vercelCliVersion)" deploy --archive=tgz --no-wait --yes --token $token --scope $config.scope
  if ($LASTEXITCODE -ne 0) { Stop-Release "Preview deployment failed." }
  exit 0
}

if (-not $PreviewUrl) {
  Stop-Release "Promotion requires -PreviewUrl for the exact preview that passed QA."
}
if ($PreviewUrl -notmatch "^https://caseload-select-[a-z0-9-]+\.vercel\.app/?$") {
  Stop-Release "Preview URL does not belong to the expected CaseLoad Select deployment pattern."
}
if (-not $VisualQAConfirmed) {
  Stop-Release "Promotion requires -VisualQAConfirmed after client and operator portal checks."
}

$token = Get-VercelToken
Write-Host "Promoting approved preview to $($config.productionAlias)."
& npx.cmd --yes "vercel@$($config.vercelCliVersion)" promote $PreviewUrl --yes --token $token --scope $config.scope
if ($LASTEXITCODE -ne 0) { Stop-Release "Production promotion failed." }
