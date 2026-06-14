import { storage } from './firebase'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'

export async function uploadSignatureSVG(uid: string, svgDataUrl: string): Promise<string> {
  const response = await fetch(svgDataUrl)
  const blob = await response.blob()
  const storageRef = ref(storage, `signatures/${uid}/signature.svg`)
  await uploadBytes(storageRef, blob, { contentType: 'image/svg+xml' })
  return getDownloadURL(storageRef)
}
