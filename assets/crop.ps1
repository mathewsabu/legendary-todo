Add-Type -AssemblyName System.Drawing

$pngPath = Resolve-Path "icon.png"
if (-not (Test-Path $pngPath)) {
    Write-Error "icon.png not found!"
    Exit
}

$src = [System.Drawing.Image]::FromFile($pngPath)
$bmp = New-Object System.Drawing.Bitmap($src)

$minX = $bmp.Width
$maxX = 0
$minY = $bmp.Height
$maxY = 0

# Scan all pixels to find the bounding box of non-transparent elements
for ($y = 0; $y -lt $bmp.Height; $y++) {
    for ($x = 0; $x -lt $bmp.Width; $x++) {
        $pixel = $bmp.GetPixel($x, $y)
        # Check if the pixel has any visible alpha (transparency threshold > 15)
        if ($pixel.A -gt 15) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}

# If no non-transparent pixels found, exit
if ($minX -ge $bmp.Width -or $minY -ge $bmp.Height) {
    Write-Warning "No transparent pixels detected or entire image is transparent."
    $src.Dispose()
    $bmp.Dispose()
    Exit
}

# Add 2px safety padding around the cropped bounds to prevent rounded corner clipping
$padding = 2
$cropX = [Math]::Max(0, $minX - $padding)
$cropY = [Math]::Max(0, $minY - $padding)
$cropW = [Math]::Min($bmp.Width - $cropX, ($maxX - $minX) + (2 * $padding))
$cropH = [Math]::Min($bmp.Height - $cropY, ($maxY - $minY) + (2 * $padding))

# Crop the image
$cropped = New-Object System.Drawing.Bitmap($cropW, $cropH)
$g = [System.Drawing.Graphics]::FromImage($cropped)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

$srcRect = New-Object System.Drawing.Rectangle($cropX, $cropY, $cropW, $cropH)
$destRect = New-Object System.Drawing.Rectangle(0, 0, $cropW, $cropH)

$g.DrawImage($bmp, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

$src.Dispose()
$bmp.Dispose()
$g.Dispose()

# Save the cropped bitmap
$tempPath = [System.IO.Path]::GetTempFileName()
$cropped.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)
$cropped.Dispose()

# Replace original icon file
Move-Item -Path $tempPath -Destination $pngPath -Force
Write-Host "Successfully cropped empty margins of icon.png!"
