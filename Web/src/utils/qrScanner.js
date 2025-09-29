// Cross-browser QR scanner using npm jsqr + native BarcodeDetector (when available)
import jsQR from 'jsqr'

export async function startQrScanner({ video, onDecode, onError } = {}){
  if (!video) throw new Error('video element required')
  let rafId = null
  let stream = null

  const ensureVideoAttrs = () => {
    try { video.setAttribute('playsinline', '') } catch {}
    try { video.setAttribute('autoplay', '') } catch {}
    try { video.setAttribute('muted', '') } catch {}
    try { video.playsInline = true } catch {}
    try { video.muted = true; video.defaultMuted = true } catch {}
  }
  ensureVideoAttrs()

  try{
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
  } catch (e){ onError && onError(e); throw e }
  video.srcObject = stream
  try { await video.play() } catch { /* iOS 16 需要靜音 + playsinline */ }
  if (video.readyState < 2){
    await new Promise((resolve) => {
      const handler = () => { video.removeEventListener('loadeddata', handler); resolve() }
      video.addEventListener('loadeddata', handler, { once: true })
    })
  }

  let detector = null
  if ('BarcodeDetector' in window) {
    try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }) } catch { detector = null }
  }

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  const tick = async () => {
    try{
      if (detector) {
        const codes = await detector.detect(video)
        if (codes && codes.length){
          const raw = String(codes[0].rawValue || '').trim()
          if (raw){ onDecode && onDecode(raw); return }
        }
      } else {
        const w = video.videoWidth, h = video.videoHeight
        if (w && h){
          canvas.width = w; canvas.height = h
          ctx.drawImage(video, 0, 0, w, h)
          const imgData = ctx.getImageData(0, 0, w, h)
          const res = jsQR(imgData.data, w, h)
          if (res && res.data){ const raw = String(res.data).trim(); if (raw){ onDecode && onDecode(raw); return } }
        }
      }
    } catch (e){ onError && onError(e) }
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)

  return {
    stop(){
      try { if (rafId) cancelAnimationFrame(rafId) } catch {}
      try { video.pause() } catch {}
      try { (stream?.getTracks?.() || []).forEach(t => t.stop()) } catch {}
    }
  }
}

export async function decodeImageFile(file){
  return new Promise((resolve) => {
    try{
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        try{
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          const width = img.naturalWidth || img.width || 0
          const height = img.naturalHeight || img.height || 0
          if (!width || !height){ resolve(null); return }
          const maxDim = Math.max(width, height)
          const scale = maxDim > 1200 ? 1200 / maxDim : 1
          canvas.width = Math.floor(width * scale)
          canvas.height = Math.floor(height * scale)
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const res = jsQR(data.data, canvas.width, canvas.height)
          resolve(res && res.data ? String(res.data).trim() : null)
        } catch { resolve(null) }
        finally { URL.revokeObjectURL(url) }
      }
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
      img.src = url
    } catch { resolve(null) }
  })
}
