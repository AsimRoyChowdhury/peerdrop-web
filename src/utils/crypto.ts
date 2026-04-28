export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToBuffer(base64: string): Uint8Array {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

export async function deriveKey(pin: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.digest('SHA-256', enc.encode(pin));
  
  return window.crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptSdp(sdp: string, secretPin: string): Promise<string> {
  const key = await deriveKey(secretPin);
  const enc = new TextEncoder();
  const nonce = window.crypto.getRandomValues(new Uint8Array(12));
  
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    enc.encode(sdp)
  );
  
  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  const payload = new Uint8Array(nonce.length + ciphertextBytes.length);
  payload.set(nonce, 0);
  payload.set(ciphertextBytes, nonce.length);
  
  return bufferToBase64(payload.buffer);
}

export async function decryptSdp(encryptedBase64: string, secretPin: string): Promise<string> {
  const key = await deriveKey(secretPin);
  const payload = base64ToBuffer(encryptedBase64);
  
  const nonce = payload.slice(0, 12);
  const ciphertext = payload.slice(12);
  
  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    ciphertext
  );
  
  const dec = new TextDecoder();
  return dec.decode(decryptedBuffer);
}