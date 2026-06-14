import { storage } from './firebase'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'

export async function uploadSignatureSVG(uid: string, svgDataUrl: string): Promise<string> {
  // Decode the data URL directly — avoids fetch() which can fail on data: URLs
  const commaIdx = svgDataUrl.indexOf(',')
  const svgText = decodeURIComponent(svgDataUrl.slice(commaIdx + 1))
  const blob = new Blob([svgText], { type: 'image/svg+xml' })
  const storageRef = ref(storage, `signatures/${uid}/signature.svg`)
  await uploadBytes(storageRef, blob, { contentType: 'image/svg+xml' })
  return getDownloadURL(storageRef)
}
