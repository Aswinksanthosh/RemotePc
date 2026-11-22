/**
 * "Now playing": what Windows shows in its own media pop-up (title, artist, cover, progress), read from the system media
 * controls (SMTC). It is the same information for Spotify, YouTube in a browser, VLC and so on. Read only.
 */

const PRE = String.raw`Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + [char]96 + '1') })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$s = $mgr.GetCurrentSession()
if (-not $s) { 'none'; return }
$p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])`

/** One JSON line: title, artist, status (Playing, Paused ...), pos and end in seconds; or "none". */
export const MEDIA_INFO = String.raw`${PRE}
$tl = $s.GetTimelineProperties()
@{ title = [string]$p.Title; artist = [string]$p.Artist; status = [string]$s.GetPlaybackInfo().PlaybackStatus; pos = [int]$tl.Position.TotalSeconds; end = [int]$tl.EndTime.TotalSeconds } | ConvertTo-Json -Compress`

/** The cover picture as base64 (nothing when there is none or it is over 1.5 MB). */
export const MEDIA_COVER = String.raw`${PRE}
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
if (-not $p.Thumbnail) { return }
$str = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
$ms = New-Object System.IO.MemoryStream
[System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($str).CopyTo($ms)
if ($ms.Length -gt 0 -and $ms.Length -le 1500000) { [Convert]::ToBase64String($ms.ToArray()) }`

// eslint-disable-next-line no-control-regex -- control characters are removed on purpose
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n)
const secs = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 86_400 ? Math.floor(Number(v)) : 0)

/** { title, artist, playing, pos, end } from MEDIA_INFO output; null when nothing is playing or the answer is odd. */
export function parseMedia(text) {
  const line = String(text ?? '').trim().split(/\r?\n/).at(-1) ?? ''
  if (!line.startsWith('{')) return null
  try {
    const j = JSON.parse(line)
    const title = clean(j.title, 120)
    if (!title) return null
    const end = secs(j.end)
    return { title, artist: clean(j.artist, 120), playing: j.status === 'Playing', pos: end ? Math.min(secs(j.pos), end) : 0, end }
  } catch {
    return null
  }
}

/** Picture type from the first bytes, or '' if it is not a picture the page may show. */
export function pictureType(bytes) {
  if (bytes?.length > 12) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
    if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  }
  return ''
}
