// Cross-browser QR scanner using npm jsqr + native BarcodeDetector (when available)
import jsQR from 'jsqr'

export async function startQrScanner({ video, onDecode, onError } = {}){
  if (!video) throw new Error('video element required')
  let rafId = null
  let stream = null

  try{
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
  } catch (e){ onError && onError(e); throw e }
  video.srcObject = stream
  await video.play()

  let detector = null
  if ('BarcodeDetector' in window) {
    try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }) } catch { detector = null }
  }

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

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
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')
          canvas.width = img.naturalWidth || img.width
          canvas.height = img.naturalHeight || img.height
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const res = jsQR(data.data, canvas.width, canvas.height)
          resolve(res && res.data ? String(res.data).trim() : null)
        }
        img.onerror = () => resolve(null)
        img.src = reader.result
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    } catch { resolve(null) }
  })
}
