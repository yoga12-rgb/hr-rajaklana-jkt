import sharp from 'sharp';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { ApiError, sha256 } from './security.mjs';
import manifest from './face-model-manifest.json' with { type: 'json' };

const require = createRequire(import.meta.url);
/** @type {Promise<{tf:typeof import('@tensorflow/tfjs'),faceapi:typeof import('@vladmandic/face-api')}>|undefined} */
let loading;
export const MODEL_ID = 'face-api-1.7.15-v1';
export const FACE_DISTANCE_LIMIT = 0.48;
async function runtime() {
  if (!loading) loading = (async () => {
    const tf = require('@tensorflow/tfjs');
    const wasm = require('@tensorflow/tfjs-backend-wasm');
    wasm.setWasmPaths(dirname(require.resolve('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm')) + '/');
    await tf.setBackend('wasm'); await tf.ready();
    const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
    const modelDir = join(dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
    // The lockfile pins the package; runtime hashes additionally pin every model
    // binary and weight manifest so a changed deployment fails closed.
    for (const [file, expected] of Object.entries(manifest.files)) {
      if (sha256(await readFile(join(modelDir, file))) !== expected) throw new Error('Model integrity check failed');
    }
    await Promise.all([faceapi.nets.tinyFaceDetector.loadFromDisk(modelDir), faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir), faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir)]);
    return { tf, faceapi };
  })().catch(error => { loading = undefined; throw error; });
  return loading;
}
/** @param {number[]} a @param {number[]} b */
export function descriptorDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 128 || b.length !== 128 || [...a, ...b].some(x => !Number.isFinite(x))) throw new ApiError('reference_invalid', 'Referensi wajah perlu didaftarkan ulang oleh HR.');
  return Math.sqrt(a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0));
}
/** @param {number[]} reference @param {number[]} candidate */
export function assertFaceMatch(reference, candidate) {
  if (descriptorDistance(reference, candidate) > FACE_DISTANCE_LIMIT) throw new ApiError('face_mismatch', 'Wajah belum cocok dengan referensi yang disetujui. Ambil ulang dengan cahaya cukup atau minta bantuan HR.');
}
/** @param {Buffer} data @param {number} width @param {number} height @param {{x:number,y:number,width:number,height:number}} box */
function sharpness(data, width, height, box) {
  let sum = 0, square = 0, count = 0;
  const left = Math.max(1, Math.floor(box.x)), right = Math.min(width - 1, Math.ceil(box.x + box.width));
  const top = Math.max(1, Math.floor(box.y)), bottom = Math.min(height - 1, Math.ceil(box.y + box.height));
  /** @param {number} x @param {number} y */
  const gray = (x, y) => { const i = (y * width + x) * 3; return (data[i] + data[i + 1] + data[i + 2]) / 3; };
  for (let y = top; y < bottom; y += 2) for (let x = left; x < right; x += 2) {
    const edge = gray(x - 1,y)+gray(x+1,y)+gray(x,y-1)+gray(x,y+1)-4*gray(x,y);
    sum += edge; square += edge * edge; count++;
  }
  return count ? square / count - (sum / count) ** 2 : 0;
}
/** @param {Buffer} image */
export async function extractFace(image) {
  if (!Buffer.isBuffer(image) || image.length < 1000 || image.length > 2 * 1024 * 1024) throw new ApiError('image_size', 'Gunakan foto JPEG maksimal 2 MB.');
  let decoded;
  try {
    const metadata = await sharp(image, { limitInputPixels: 12000000 }).metadata();
    if (!['jpeg','png','webp'].includes(metadata.format) || (metadata.pages ?? 1) > 1 || !metadata.width || !metadata.height || metadata.width < 320 || metadata.height < 320) throw new Error();
    decoded = await sharp(image, { limitInputPixels: 12000000 }).rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  } catch { throw new ApiError('image_invalid', 'Foto tidak dapat dibaca atau resolusinya terlalu kecil. Ambil ulang dari kamera.'); }
  const { tf, faceapi } = await runtime();
  const { data, info } = decoded;
  const tensor = tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');
  try {
    // FaceAPI bundles a duplicate Tensor declaration with private fields. At
    // runtime both bindings use the same pinned TFJS instance (covered by the
    // real inference test); bridge only this third-party declaration boundary.
    const input = /** @type {Parameters<typeof faceapi.detectAllFaces>[0]} */ (/** @type {unknown} */ (tensor));
    const results = await faceapi.detectAllFaces(input, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.65 })).withFaceLandmarks().withFaceDescriptors();
    if (results.length !== 1) throw new ApiError('face_count', results.length ? 'Pastikan hanya satu wajah terlihat di kamera.' : 'Wajah belum terdeteksi. Hadapkan wajah ke kamera dengan cahaya cukup.');
    const result = results[0], box = result.detection.box;
    const proportion = box.width * box.height / (info.width * info.height);
    if (box.width < 100 || box.height < 100 || proportion < 0.06 || proportion > 0.72 || box.x < 3 || box.y < 3 || box.x + box.width > info.width - 3 || box.y + box.height > info.height - 3) throw new ApiError('face_position', 'Letakkan seluruh wajah di dalam bingkai dengan jarak yang cukup.');
    const mean = data.reduce((total, value) => total + value, 0) / data.length;
    if (mean < 35 || mean > 235 || sharpness(data, info.width, info.height, box) < 18) throw new ApiError('face_quality', 'Foto terlalu gelap, terang, atau buram. Gunakan cahaya cukup dan tahan kamera tetap stabil.');
    const eyes = result.landmarks.getLeftEye().concat(result.landmarks.getRightEye());
    if (Math.abs(eyes.slice(0,6).reduce((s,p)=>s+p.y,0)/6-eyes.slice(6).reduce((s,p)=>s+p.y,0)/6) > box.width * 0.17) throw new ApiError('face_angle', 'Tegakkan kepala dan hadapkan wajah ke kamera.');
    return { descriptor: Array.from(result.descriptor), modelId: MODEL_ID, imageHash: sha256(image) };
  } finally { tensor.dispose(); }
}
