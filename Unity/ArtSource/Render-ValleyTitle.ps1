param([string]$OutputPath = (Join-Path $PSScriptRoot '../Assets/Resources/ValleyTitle.png'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$fonts = New-Object System.Drawing.Text.PrivateFontCollection
$fonts.AddFontFile((Join-Path $PSScriptRoot '../Assets/Resources/NotoSansJP-Regular.otf'))
$bitmap = New-Object System.Drawing.Bitmap 1800,340
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::Transparent)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$brush = [System.Drawing.Brushes]::White
$format = [System.Drawing.StringFormat]::GenericTypographic

function Draw-Lettering([string]$Text,[float]$Size,[float]$X,[float]$Y,[float]$Weight) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddString($Text,$fonts.Families[0],0,$Size,(New-Object System.Drawing.PointF $X,$Y),$format)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White),$Weight
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawPath($pen,$path)
    $graphics.FillPath($brush,$path)
    $pen.Dispose()
    $path.Dispose()
}

# A cut-stone quarry stamp and a broad, readable Japanese wordmark.
$outline = New-Object System.Drawing.Pen ([System.Drawing.Color]::White),10
$outline.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Bevel
$stamp = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF 164,37), (New-Object System.Drawing.PointF 300,174),
    (New-Object System.Drawing.PointF 164,313), (New-Object System.Drawing.PointF 27,174))
$graphics.DrawPolygon($outline,$stamp)
$ridge = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF 72,200), (New-Object System.Drawing.PointF 122,114),
    (New-Object System.Drawing.PointF 166,172), (New-Object System.Drawing.PointF 209,126),
    (New-Object System.Drawing.PointF 256,200))
$graphics.DrawLines($outline,$ridge)
$pick = New-Object System.Drawing.Pen ([System.Drawing.Color]::White),14
$pick.StartCap = $pick.EndCap = [System.Drawing.Drawing2D.LineCap]::Square
$graphics.DrawLine($pick,132,255,211,175)
$graphics.DrawBezier($pick,163,169,188,163,225,169,237,194)
Draw-Lettering '谷の採鉱競争' 232 345 14 7.2
$graphics.DrawLine($outline,365,292,1732,292)
$bitmap.Save([System.IO.Path]::GetFullPath($OutputPath),[System.Drawing.Imaging.ImageFormat]::Png)
$pick.Dispose()
$outline.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
$fonts.Dispose()
