import { describe, expect, it } from 'vitest';
import { validateApplicationEnvironment, validateDeploymentConfiguration, validatePublicSupabaseConfiguration as validate } from './configuration';

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

describe('Pemisahan environment deployment', () => {
  const publicConfiguration = { PUBLIC_SUPABASE_URL: project, PUBLIC_SUPABASE_ANON_KEY: publishable };

  it('tetap mengizinkan demo lokal dengan environment development', () => {
    expect(validateDeploymentConfiguration({})).toMatchObject({ environment: 'development', supabase: { mode: 'demo' } });
    expect(validateApplicationEnvironment(' ')).toBe('development');
  });

  it('menerima nama environment yang tersedia dan menolak nama lain tanpa mencetak nilainya', () => {
    for (const environment of ['production', 'preview', 'development'] as const) {
      expect(validateApplicationEnvironment(` ${environment} `)).toBe(environment);
    }
    const unexpected = 'private-project-secret';
    try { validateApplicationEnvironment(unexpected); throw new Error('Seharusnya ditolak'); }
    catch (error) { expect(String(error)).toContain('PUBLIC_APP_ENV'); expect(String(error)).not.toContain(unexpected); }
  });

  it('mengambil environment platform hosted saat label publik belum diisi', () => {
    expect(validateDeploymentConfiguration(publicConfiguration, { hosted: true, environment: 'preview' })).toMatchObject({ environment: 'preview', supabase: { mode: 'live' } });
    expect(validateDeploymentConfiguration(publicConfiguration, { hosted: true, environment: 'production' }).environment).toBe('production');
  });

  it('menghentikan build hosted jika kedua nilai Supabase kosong', () => {
    for (const environment of ['production', 'preview', 'development']) {
      expect(() => validateDeploymentConfiguration({}, { hosted: true, environment })).toThrow('Deployment memerlukan');
    }
  });

  it('menghentikan build Production atau Preview lokal yang belum terhubung backend', () => {
    for (const environment of ['production', 'preview']) {
      expect(() => validateDeploymentConfiguration({ PUBLIC_APP_ENV: environment })).toThrow('Deployment memerlukan');
    }
  });

  it('menolak label publik yang tertukar antara Production dan Preview', () => {
    expect(() => validateDeploymentConfiguration({ ...publicConfiguration, PUBLIC_APP_ENV: 'production' }, { hosted: true, environment: 'preview' })).toThrow('tidak sesuai');
    expect(() => validateDeploymentConfiguration({ ...publicConfiguration, PUBLIC_APP_ENV: 'preview' }, { hosted: true, environment: 'production' })).toThrow('tidak sesuai');
  });

  it('menerima pasangan environment dan backend live yang sesuai', () => {
    for (const environment of ['production', 'preview'] as const) {
      expect(validateDeploymentConfiguration({ ...publicConfiguration, PUBLIC_APP_ENV: environment }, { hosted: true, environment })).toMatchObject({ environment, supabase: { mode: 'live' } });
    }
  });

  it('menolak backend loopback pada deployment hosted sambil mempertahankan Supabase lokal', () => {
    for (const url of ['http://localhost:54321', 'https://127.0.0.1:54321', 'https://[::1]:54321']) {
      const env = { ...publicConfiguration, PUBLIC_SUPABASE_URL: url };
      expect(() => validateDeploymentConfiguration(env, { hosted: true, environment: 'preview' })).toThrow('proyek Supabase HTTPS');
      expect(validateDeploymentConfiguration(env).supabase.mode).toBe('live');
    }
  });
});
