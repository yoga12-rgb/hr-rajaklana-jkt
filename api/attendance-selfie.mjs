import sharp from 'sharp';
import { ApiError, authenticate, bodyJSON, checkRPC, fail, json, requireFresh, sha256 } from '../server/security.mjs';

// Validate a readable photo, never a person's identity or face descriptor.
/** @param {Buffer} image */
export async function validateSelfieImage(image) {
  if (!Buffer.isBuffer(image) || image.length < 1000 || image.length > 2 * 1024 * 1024) throw new ApiError('image_size', 'Gunakan foto JPEG maksimal 2 MB.');
  try {
    const decoder = sharp(image, { limitInputPixels: 12000000, failOn: 'warning' });
    const metadata = await decoder.metadata();
    if (metadata.format !== 'jpeg' || (metadata.pages ?? 1) > 1 || !metadata.width || !metadata.height || metadata.width < 320 || metadata.height < 320) throw new Error();
    await decoder.resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).raw().toBuffer();
  } catch { throw new ApiError('image_invalid', 'Foto tidak dapat dibaca atau resolusinya terlalu kecil. Ambil ulang dari kamera.'); }
}

/** @param {Request} request */
export async function POST(request) {
  try {
    const { admin, client, user, employee } = await authenticate(request);
    const input = await bodyJSON(request, 16000);
    if (input.action !== 'verify') throw new ApiError('action', 'Tindakan tidak dikenal.');
    if (!employee.can_clock) throw new ApiError('forbidden', 'Akun tidak diizinkan mencatat absensi.', 403);
    requireFresh(input.geoCapturedAt); requireFresh(input.selfieCapturedAt);
    const path = input.selfiePath;
    if (typeof path !== 'string' || !path.startsWith(user.id + '/') || path.includes('..') || path.length > 200) throw new ApiError('selfie_owner', 'Foto absensi bukan milik akun ini.', 403);
    const rate = checkRPC(await admin.rpc('auth_rate_limit', { p_key_hash: sha256('attendance-selfie-' + user.id), p_limit: 12 }));
    if (!rate) throw new ApiError('rate_limited', 'Terlalu banyak percobaan. Tunggu sebentar atau minta bantuan HR.', 429);
    const objectId = checkRPC(await admin.rpc('attendance_selfie_object', { p_employee_id: employee.id, p_selfie_path: path }));
    const downloaded = await admin.storage.from('attendance-selfies').download(path);
    if (downloaded.error || !downloaded.data) throw new ApiError('selfie_missing', 'Selfie belum berhasil diunggah. Ambil ulang.');
    if (downloaded.data.size > 2 * 1024 * 1024) throw new ApiError('image_size', 'Gunakan foto JPEG maksimal 2 MB.');
    const bytes = Buffer.from(await downloaded.data.arrayBuffer());
    await validateSelfieImage(bytes);
    requireFresh(input.geoCapturedAt); requireFresh(input.selfieCapturedAt);
    const access = checkRPC(await client.rpc('auth_access_context'));
    if (!access || Array.isArray(access) || access.allowed !== true || access.requires_mfa !== false || !['aal1','aal2'].includes(access.current_level) || access.employee_id !== employee.id || access.reason !== null) throw new ApiError('unauthorized', 'Sesi berakhir. Silakan login kembali.', 401);
    const rows = checkRPC(await admin.rpc('attendance_issue_selfie_receipt', {
      p_employee_id: employee.id, p_storage_object_id: objectId, p_selfie_path: path, p_selfie_sha256: sha256(bytes), p_shift: input.shift,
      p_latitude: input.latitude, p_longitude: input.longitude, p_accuracy_m: input.accuracy, p_geo_captured_at: input.geoCapturedAt,
      p_selfie_captured_at: input.selfieCapturedAt, p_selfie_outlet_name: input.selfieOutletName
    }));
    return json({ verificationToken: rows[0].id, expiresAt: rows[0].expires_at });
  } catch (error) { return fail(error); }
}
