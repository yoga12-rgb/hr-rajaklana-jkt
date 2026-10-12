export interface SelfieStamp {
  outletName: string;
  capturedAt: string;
  latitude: number;
  longitude: number;
  accuracy: number;
}

export function selfieTimestampLabel(value: string): string {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error('Waktu pengambilan selfie tidak valid.');
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')} · ${part('hour')}:${part('minute')}:${part('second')} WIB`;
}

export function selfieStampLines(stamp: SelfieStamp): string[] {
  if (!stamp.outletName.trim()) throw new Error('Nama outlet diperlukan untuk cap selfie.');
  if (!Number.isFinite(stamp.latitude) || Math.abs(stamp.latitude) > 90
    || !Number.isFinite(stamp.longitude) || Math.abs(stamp.longitude) > 180
    || !Number.isFinite(stamp.accuracy) || stamp.accuracy <= 0) throw new Error('Lokasi pengambilan selfie tidak valid.');
  return [
    `Outlet: ${stamp.outletName.trim().replace(/\s+/gu, ' ')}`,
    `GPS: ${stamp.latitude.toFixed(6)}, ${stamp.longitude.toFixed(6)} · ±${Math.ceil(stamp.accuracy)} m`,
    `Foto: ${selfieTimestampLabel(stamp.capturedAt)}`
  ];
}

function wrapCaption(context: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  let remaining = Array.from(text);
  const lines: string[] = [];
  while (remaining.length && lines.length < maxLines) {
    let end = 0;
    while (end < remaining.length && context.measureText(remaining.slice(0, end + 1).join('')).width <= width) end++;
    if (!end) throw new Error('Ukuran gambar terlalu kecil untuk cap selfie.');
    if (end < remaining.length) {
      const space = remaining.slice(0, end).lastIndexOf(' ');
      if (space > 0) end = space;
    }
    lines.push(remaining.slice(0, end).join('').trim());
    remaining = remaining.slice(end);
    while (remaining[0] === ' ') remaining.shift();
  }
  if (remaining.length) {
    const last = Array.from(lines[lines.length - 1]);
    while (last.length && context.measureText(`${last.join('')}…`).width > width) last.pop();
    lines[lines.length - 1] = `${last.join('')}…`;
  }
  return lines;
}

export function renderStampedSelfie(canvas: HTMLCanvasElement, frame: CanvasImageSource, frameWidth: number, frameHeight: number, stamp: SelfieStamp) {
  if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight) || frameWidth < 120 || frameHeight < 120) {
    throw new Error('Kamera belum menghasilkan gambar yang cukup jelas.');
  }
  const captions = selfieStampLines(stamp);
  const scale = Math.min(1, 800 / Math.max(frameWidth, frameHeight));
  const width = Math.round(frameWidth * scale), imageHeight = Math.round(frameHeight * scale);
  if (width < 120) throw new Error('Ukuran gambar terlalu kecil untuk cap selfie.');
  canvas.width = width;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Selfie belum berhasil diproses. Silakan coba kembali.');
  const fontSize = Math.max(12, Math.min(22, Math.round(width / 32)));
  const padding = Math.max(10, Math.round(width * .03)), lineHeight = Math.ceil(fontSize * 1.45);
  const font = `600 ${fontSize}px system-ui, sans-serif`;
  context.font = font;
  const lines = captions.flatMap((text, index) => wrapCaption(context, text, width - padding * 2, index === 0 ? 2 : Infinity));
  const footerHeight = padding * 2 + lineHeight * lines.length + 4;
  canvas.height = imageHeight + footerHeight;
  // The footer extends the image; no part of the camera frame is covered.
  context.drawImage(frame, 0, 0, width, imageHeight);
  context.fillStyle = '#f6f1e3';
  context.fillRect(0, imageHeight, width, footerHeight);
  context.fillStyle = '#f3c73e';
  context.fillRect(0, imageHeight, width, 4);
  context.font = font;
  context.textBaseline = 'top';
  context.textAlign = 'left';
  context.fillStyle = '#3d321c';
  lines.forEach((line, index) => context.fillText(line, padding, imageHeight + padding + 4 + index * lineHeight));
  return { width, height: canvas.height, imageHeight, lines };
}

export async function createStampedSelfie(video: HTMLVideoElement, stamp: SelfieStamp): Promise<Blob> {
  const canvas = document.createElement('canvas');
  renderStampedSelfie(canvas, video, video.videoWidth, video.videoHeight, stamp);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', .88));
  if (!blob) throw new Error('Selfie belum berhasil diambil. Silakan coba kembali.');
  return blob;
}
