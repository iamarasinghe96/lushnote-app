import { storage } from './firebase'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'

export async function uploadSignature(uid: string, dataUrl: string): Promise<string> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  const storageRef = ref(storage, `signatures/${uid}/signature.png`)
  await uploadBytes(storageRef, blob, { contentType: 'image/png' })
  return getDownloadURL(storageRef)
}
