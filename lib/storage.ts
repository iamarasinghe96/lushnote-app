import { storage } from './firebase'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'

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
