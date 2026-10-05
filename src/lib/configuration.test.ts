import { describe, expect, it } from 'vitest';
import { validatePublicSupabaseConfiguration as validate } from './configuration';

const project = 'https://project.supabase.co';
const publishable = 'sb_publishable_example';
const jwt = (role: string) => `${btoa('{"alg":"HS256"}').replace(/=/g, '')}.${btoa(JSON.stringify({ role })).replace(/=/g, '')}.signature`;

describe('Konfigurasi publik Supabase', () => {
  it('memulai demo hanya ketika kedua nilai kosong', () => {
    expect(validate(' ', '')).toMatchObject({ mode: 'demo' });
    expect(() => validate(project, '')).toThrow('belum lengkap');
    expect(() => validate('', publishable)).toThrow('belum lengkap');
  });
  it('menerima kunci publik dan membersihkan whitespace serta slash akhir URL', () => {
    expect(validate(` ${project}/ `, ` ${publishable} `)).toEqual({ mode: 'live', url: project, key: publishable });
    expect(validate(project, jwt('anon')).mode).toBe('live');
  });
  it('menolak kunci server tanpa memasukkan nilainya dalam pesan', () => {
    const secret = 'sb_secret_do_not_expose';
    const serviceRole = jwt('service_role');
    for (const key of [secret, serviceRole]) {
      try { validate(project, key); throw new Error('Seharusnya ditolak'); }
      catch (error) { expect(String(error)).toContain('tidak boleh'); expect(String(error)).not.toContain(key); }
    }
  });
  it('menolak URL dan kunci rusak serta JWT akun pengguna', () => {
    expect(() => validate('not-a-url', publishable)).toThrow('URL');
    for (const key of ['invalid', 'sb_publishable_', 'a.b.c', jwt('authenticated')]) expect(() => validate(project, key)).toThrow('publishable key atau anon key');
    for (const url of ['http://project.supabase.co', `${project}/rest/v1`, `${project}?secret=value`, 'https://user:password@project.supabase.co']) expect(() => validate(url, publishable)).toThrow('origin HTTPS');
  });
  it('mendukung Supabase HTTP lokal', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) expect(validate(`http://${host}:54321`, publishable).mode).toBe('live');
  });
});
