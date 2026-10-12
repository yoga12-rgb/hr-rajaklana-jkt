import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStampedSelfie, renderStampedSelfie, selfieStampLines, selfieTimestampLabel, type SelfieStamp } from './selfie';

const stamp: SelfieStamp = {
  outletName: 'Outlet Contoh A', capturedAt: '2026-10-12T00:10:15.000Z',
  latitude: -6.2, longitude: 106.816666, accuracy: 10
};

function canvasFixture() {
  const context = {
    font: '', textBaseline: '', textAlign: '', fillStyle: '',
    measureText: (text: string) => ({ width: Array.from(text).length * (parseInt(context.font.match(/(\d+)px/)?.[1] ?? '12') / 2) }),
    drawImage: vi.fn(), fillRect: vi.fn(), fillText: vi.fn()
  };
  const canvas = { width: 0, height: 0, getContext: () => context, toBlob: vi.fn() };
  return { canvas: canvas as unknown as HTMLCanvasElement, context };
}

afterEach(() => vi.unstubAllGlobals());

describe('Cap lokasi dan waktu selfie', () => {
  it('menggunakan WIB dan tanggal saat foto diambil, termasuk pergantian hari dari UTC', () => {
    expect(selfieTimestampLabel('2026-10-11T17:00:01.000Z')).toBe('12 Okt 2026 · 00:00:01 WIB');
    expect(selfieTimestampLabel('2026-10-12T07:10:15+07:00')).toBe('12 Okt 2026 · 07:10:15 WIB');
    expect(selfieTimestampLabel('2026-10-12T00:10:15.000Z')).toBe('12 Okt 2026 · 07:10:15 WIB');
  });

  it('memakai nama outlet dinamis dan koordinat GPS enam desimal, termasuk koordinat nol', () => {
    expect(selfieStampLines({ ...stamp, outletName: '  Outlet   Baru\nJabodetabek  ', latitude: 0, longitude: 0, accuracy: .5 })).toEqual([
      'Outlet: Outlet Baru Jabodetabek', 'GPS: 0.000000, 0.000000 · ±1 m', 'Foto: 12 Okt 2026 · 07:10:15 WIB'
    ]);
    expect(selfieStampLines(stamp)[1]).toContain('-6.200000, 106.816666');
  });

  it.each([
    { capturedAt: 'bukan tanggal' }, { outletName: '  ' }, { latitude: NaN }, { latitude: 91 },
    { longitude: Infinity }, { longitude: 181 }, { accuracy: 0 }, { accuracy: NaN }
  ])('menolak metadata foto yang tidak valid: %j', invalid => {
    expect(() => selfieStampLines({ ...stamp, ...invalid })).toThrow();
  });

  it.each([[640, 480], [480, 640], [1920, 1080]])('menaruh cap di luar frame %ix%i sehingga wajah tidak tertutup', (width, height) => {
    const { canvas, context } = canvasFixture();
    const frame = {} as CanvasImageSource;
    const result = renderStampedSelfie(canvas, frame, width, height, stamp);
    expect(context.drawImage).toHaveBeenCalledWith(frame, 0, 0, result.width, result.imageHeight);
    expect(result.height).toBeGreaterThan(result.imageHeight);
    expect(Math.max(result.width, result.imageHeight)).toBeLessThanOrEqual(800);
    for (const [, y] of context.fillRect.mock.calls.map(call => [call[0], call[1]])) expect(y).toBeGreaterThanOrEqual(result.imageHeight);
    for (const [text, x, y] of context.fillText.mock.calls) {
      expect(y).toBeGreaterThan(result.imageHeight);
      expect(x + context.measureText(text).width).toBeLessThanOrEqual(result.width);
      expect(y).toBeLessThan(result.height);
    }
  });

  it('membungkus foto portrait sempit dan nama panjang, tanpa memotong koordinat atau jam', () => {
    const { canvas, context } = canvasFixture();
    const result = renderStampedSelfie(canvas, {} as CanvasImageSource, 120, 240, { ...stamp, outletName: 'Outlet Jabodetabek '.repeat(20) });
    expect(result.lines.some(line => line.endsWith('…'))).toBe(true);
    expect(result.lines.join(' ')).toContain('-6.200000,');
    expect(result.lines.join(' ')).toContain('106.816666');
    expect(result.lines.join(' ')).toContain('07:10:15 WIB');
    for (const line of result.lines) expect(context.measureText(line).width).toBeLessThanOrEqual(100);
  });

  it('menolak frame kamera yang kosong sebelum membuat foto', () => {
    const { canvas } = canvasFixture();
    expect(() => renderStampedSelfie(canvas, {} as CanvasImageSource, 0, 480, stamp)).toThrow();
  });

  it('menampilkan kegagalan encoding JPEG tanpa menghasilkan bukti foto kosong', async () => {
    const { canvas } = canvasFixture();
    vi.spyOn(canvas, 'toBlob').mockImplementation(callback => callback(null));
    vi.stubGlobal('document', { createElement: () => canvas });
    await expect(createStampedSelfie({ videoWidth: 640, videoHeight: 480 } as HTMLVideoElement, stamp)).rejects.toThrow('Selfie belum berhasil diambil');
  });
});
