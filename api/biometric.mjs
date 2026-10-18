import { randomUUID } from 'node:crypto';
import { ApiError, authenticate, bodyJSON, checkRPC, fail, json, requireFresh, sha256 } from '../server/security.mjs';
import { assertFaceMatch, extractFace, MODEL_ID } from '../server/face-engine.mjs';

/** @typedef {{id:string,employee_id:string,status:string,created_at:string,review_note:string|null}} Reference */
/** @typedef {{id:string,employee_id:string,status:string,descriptor:number[],image_path:string,model_id:string}} Material */
/** @param {Request} request */
export async function POST(request) {
  try {
    const { admin, client, user, employee } = await authenticate(request);
    const input = await bodyJSON(request);
    if (input.action === 'status') {
      /** @type {Reference[]} */
      const references = checkRPC(await client.from('biometric_references').select('id,employee_id,status,created_at,review_note').order('created_at',{ascending:false}));
      const own = references.filter(r => r.employee_id === employee.id);
      const pending = [];
      for (const row of references.filter(r=>r.status==='pending'&&r.employee_id!==employee.id).slice(0,50)) {
        /** @type {Material[]} */
        const materials = checkRPC(await admin.rpc('biometric_server_material',{p_employee_id:row.employee_id,p_pending:true}));
        const material = materials.find(r=>r.id===row.id);
        if (!material) continue;
        const image = await admin.storage.from('biometric-references').createSignedUrl(material.image_path,120);
        const name = await admin.from('employees').select('full_name,employee_number').eq('id',row.employee_id).single();
        pending.push({...row,name:name.data?.full_name??'Karyawan',employeeNumber:name.data?.employee_number??'',imageUrl:image.data?.signedUrl??null});
      }
      return json({own,pending});
    }
    if (input.action === 'enroll') {
      if (input.consent !== true) throw new ApiError('consent','Persetujuan penggunaan foto referensi wajib diberikan.');
      requireFresh(input.capturedAt);
      if (typeof input.image !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.image)) throw new ApiError('image_invalid','Foto kamera tidak valid.');
      const rate = checkRPC(await admin.rpc('auth_rate_limit',{p_key_hash:sha256('biometric-enroll-'+user.id),p_limit:5}));
      if (!rate) throw new ApiError('rate_limited','Terlalu banyak percobaan. Tunggu sebentar atau hubungi HR.',429);
      const image = Buffer.from(input.image,'base64');
      const face = await extractFace(image);
      requireFresh(input.capturedAt);
      const path = `${user.id}/${randomUUID()}.jpg`;
      checkRPC(await admin.rpc('biometric_stage_reference',{p_employee_id:employee.id,p_image_path:path}));
      checkRPC(await admin.storage.from('biometric-references').upload(path,image,{contentType:'image/jpeg',upsert:false}));
      const referenceId = checkRPC(await admin.rpc('biometric_enroll_server',{p_employee_id:employee.id,p_image_path:path,p_image_sha256:face.imageHash,p_descriptor:face.descriptor}));
      return json({referenceId,status:'pending'});
    }
    if (input.action === 'review') {
      checkRPC(await client.rpc('biometric_review',{p_id:input.referenceId,p_decision:input.decision,p_reason:input.reason}));
      return json({ok:true});
    }
    if (input.action === 'withdraw') {
      /** @type {Material[]} */
      const materials = checkRPC(await admin.rpc('biometric_server_material',{p_employee_id:employee.id,p_pending:true,p_all:true}));
      checkRPC(await client.rpc('biometric_withdraw'));
      if (materials.length) {
        const removed=await admin.storage.from('biometric-references').remove(materials.map(r=>r.image_path));
        if(!removed.error)for(const material of materials)await admin.rpc('biometric_cleanup_complete',{p_image_path:material.image_path});
      }
      return json({ok:true});
    }
    if (input.action !== 'verify') throw new ApiError('action','Tindakan tidak dikenal.');
    if (!employee.can_clock) throw new ApiError('forbidden','Akun tidak diizinkan mencatat absensi.',403);
    requireFresh(input.geoCapturedAt); requireFresh(input.selfieCapturedAt);
    const path = input.selfiePath;
    if (typeof path!=='string' || !path.startsWith(user.id+'/') || path.includes('..') || path.length>200) throw new ApiError('selfie_owner','Foto absensi bukan milik akun ini.',403);
    /** @type {Material[]} */
    const materials = checkRPC(await admin.rpc('biometric_server_material',{p_employee_id:employee.id,p_pending:false}));
    const reference = materials.find(r=>r.status==='approved');
    if (!reference || reference.model_id!==MODEL_ID) throw new ApiError('reference_pending','Daftarkan referensi wajah dan tunggu persetujuan HR sebelum clock in. Jika mendesak, minta pencatatan manual kepada HR.');
    const rate = checkRPC(await admin.rpc('auth_rate_limit',{p_key_hash:sha256('biometric-verify-'+user.id),p_limit:12}));
    if (!rate) throw new ApiError('rate_limited','Terlalu banyak percobaan. Tunggu sebentar atau minta bantuan HR.',429);
    const objectId=checkRPC(await admin.rpc('biometric_selfie_object',{p_employee_id:employee.id,p_selfie_path:path}));
    const downloaded = await admin.storage.from('attendance-selfies').download(path);
    if (downloaded.error || !downloaded.data) throw new ApiError('selfie_missing','Selfie belum berhasil diunggah. Ambil ulang.');
    const face = await extractFace(Buffer.from(await downloaded.data.arrayBuffer()));
    assertFaceMatch(reference.descriptor,face.descriptor);
    requireFresh(input.geoCapturedAt); requireFresh(input.selfieCapturedAt);
    const rows = checkRPC(await admin.rpc('biometric_issue_receipt',{
      p_employee_id:employee.id,p_reference_id:reference.id,p_storage_object_id:objectId,p_selfie_path:path,p_selfie_sha256:face.imageHash,p_shift:input.shift,
      p_latitude:input.latitude,p_longitude:input.longitude,p_accuracy_m:input.accuracy,p_geo_captured_at:input.geoCapturedAt,
      p_selfie_captured_at:input.selfieCapturedAt,p_selfie_outlet_name:input.selfieOutletName
    }));
    return json({verificationToken:rows[0].id,expiresAt:rows[0].expires_at});
  } catch(error) { return fail(error); }
}
