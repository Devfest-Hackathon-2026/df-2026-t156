param([string]$EditorPath='C:/Program Files/Unity/Hub/Editor/2022.3.22f1/Editor/Unity.exe', [string]$WorkRoot=$env:ORBIT_UNITY_WORK_ROOT)
$ErrorActionPreference='Stop'
$projectPath=$PSScriptRoot
$cachePath=if($WorkRoot){Join-Path $WorkRoot 'BuildTemp'}else{Join-Path $projectPath 'Logs/BuildTemp'}
New-Item -ItemType Directory -Force -Path $cachePath,(Join-Path $projectPath 'Logs') | Out-Null
if($WorkRoot){foreach($leaf in @('Library','Temp')) {
 $linkPath=Join-Path $projectPath $leaf
 $targetPath=Join-Path $WorkRoot $leaf
 if(-not(Test-Path -LiteralPath $linkPath)) {
  New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
  New-Item -ItemType Junction -Path $linkPath -Target $targetPath | Out-Null
 }
}}
$originalTemp=$env:TEMP;$originalTmp=$env:TMP
try {$env:TEMP=$cachePath;$env:TMP=$cachePath
 $buildProcess=Start-Process -FilePath $EditorPath -ArgumentList @('-batchmode','-quit','-projectPath',('"'+$projectPath+'"'),'-buildTarget','WebGL','-executeMethod','OrbitBuild.Web','-logFile',('"'+(Join-Path $projectPath 'Logs/build.log')+'"')) -WindowStyle Hidden -Wait -PassThru
 if($buildProcess.ExitCode -ne 0){throw "Unity build exited $($buildProcess.ExitCode). See Unity/Logs/build.log"}
} finally {$env:TEMP=$originalTemp;$env:TMP=$originalTmp}
