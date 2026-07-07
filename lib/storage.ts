import { storage } from './firebase'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'

// Uploads a full session recording to Storage so the server can transcribe the
// whole file in one pass (Storage has no request-body size limit, unlike the
// 4.5 MB Vercel API cap that previously forced client-side segmentation).
// The server deletes the object immediately after transcription — audio is
// never retained. Returns the storage path for the transcribe request.
export async function uploadRecording(uid: string, blob: Blob, mimeType: string): Promise<string> {
  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('webm') ? 'webm' : 'bin'
  const path = `recordings/${uid}/${crypto.randomUUID()}.${ext}`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, blob, { contentType: mimeType })
  return path
}

export async function uploadSignatureSVG(uid: string, svgDataUrl: string): Promise<string> {
  // Decode the data URL directly - avoids fetch() which can fail on data: URLs
  const commaIdx = svgDataUrl.indexOf(',')
  const svgText = decodeURIComponent(svgDataUrl.slice(commaIdx + 1))
  const blob = new Blob([svgText], { type: 'image/svg+xml' })
  const storageRef = ref(storage, `signatures/${uid}/signature.svg`)
  await uploadBytes(storageRef, blob, { contentType: 'image/svg+xml' })
  return getDownloadURL(storageRef)
}

// A user attaches their raw letterhead image to a setup request. The admin
// downloads it, cleans it up, and uploads the polished version via the admin panel.
export async function uploadLetterheadRequestImage(
  uid: string,
  orgKey: string,
  slot: 'header' | 'footer',
  file: File,
): Promise<string> {
  const ext = (file.type.split('/')[1] || 'png').replace('+xml', 'svg')
  const storageRef = ref(storage, `letterhead-requests/${uid}/${orgKey}-${slot}.${ext}`)
  await uploadBytes(storageRef, file, { contentType: file.type || 'image/png' })
  return getDownloadURL(storageRef)
}
