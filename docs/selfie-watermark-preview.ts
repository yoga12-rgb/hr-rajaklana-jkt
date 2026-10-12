import { renderStampedSelfie, type SelfieStamp } from '../src/lib/selfie.ts';

// Visual fixture only: generated frames never enter the app or attendance state.
function generatedFrame(width: number, height: number): HTMLCanvasElement {
  const frame = document.createElement('canvas');
  frame.width = width; frame.height = height;
  const context = frame.getContext('2d');
  if (!context) throw new Error('Canvas tidak tersedia pada browser ini.');
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#efe7ce'); gradient.addColorStop(1, '#d4c59a');
  context.fillStyle = gradient; context.fillRect(0, 0, width, height);
  context.fillStyle = '#f6f1e3';
  context.beginPath(); context.arc(width / 2, height * .36, Math.min(width, height) * .105, 0, Math.PI * 2); context.fill();
  context.beginPath(); context.ellipse(width / 2, height * .6, Math.min(width, height) * .21, height * .16, 0, Math.PI, 0); context.fill();
  context.strokeStyle = '#907d46'; context.lineWidth = Math.max(2, width / 220);
  context.strokeRect(width * .1, height * .08, width * .8, height * .7);
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#514329';
  const fontSize = Math.max(16, Math.round(width / 30));
  context.font = `700 ${fontSize}px system-ui, sans-serif`;
  context.fillText('CONTOH UJI', width / 2, height * .86);
  context.font = `600 ${Math.round(fontSize * .8)}px system-ui, sans-serif`;
  context.fillText('BUKAN SELFIE KARYAWAN', width / 2, height * .93);
  return frame;
}

const examples: { id: string; width: number; height: number; stamp: SelfieStamp }[] = [
  { id: 'landscape', width: 800, height: 450, stamp: {
    outletName: 'Outlet Contoh A', latitude: -6.2, longitude: 106.816666, accuracy: 10,
    capturedAt: '2026-10-12T00:03:42.000Z'
  } },
  { id: 'portrait', width: 480, height: 800, stamp: {
    outletName: 'Outlet Contoh dengan Nama Sangat Panjang untuk Pemeriksaan Pembungkusan Teks Jabodetabek',
    latitude: -6.245678, longitude: 106.812345, accuracy: 8.4,
    capturedAt: '2026-10-12T17:00:00.000Z'
  } }
];

const imageUrls: string[] = [];
window.addEventListener('pagehide', () => imageUrls.forEach(url => URL.revokeObjectURL(url)));
for (const example of examples) {
  const canvas = document.getElementById(example.id) as HTMLCanvasElement | null;
  const result = document.getElementById(`${example.id}-result`);
  if (!canvas || !result) continue;
  try {
    const frame = generatedFrame(example.width, example.height);
    const rendered = renderStampedSelfie(canvas, frame, frame.width, frame.height, example.stamp);
    result.textContent = `Hasil ${rendered.width} × ${rendered.height} piksel · ${rendered.lines.length} baris cap · seluruh gambar tetap terlihat.`;
    canvas.dataset.rendered = 'true';
    canvas.toBlob(blob => {
      if (!blob || blob.type !== 'image/jpeg') { result.textContent = 'Encoding JPEG belum berhasil.'; canvas.dataset.rendered = 'false'; return; }
      const image = document.createElement('img');
      image.id = canvas.id; image.alt = canvas.getAttribute('aria-label') ?? 'Contoh uji cap selfie';
      image.width = rendered.width; image.height = rendered.height;
      image.dataset.rendered = 'true'; image.dataset.encoded = 'jpeg'; image.dataset.bytes = String(blob.size);
      image.src = URL.createObjectURL(blob); imageUrls.push(image.src);
      canvas.replaceWith(image);
      result.textContent += ` JPEG ${(blob.size / 1024).toFixed(1)} KB.`;
    }, 'image/jpeg', .88);
  } catch (error) {
    result.textContent = error instanceof Error ? error.message : 'Contoh belum berhasil diproses.';
    canvas.dataset.rendered = 'false';
  }
}
