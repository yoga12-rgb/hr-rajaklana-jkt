const common = new Set([
  'password123', 'password1234', 'password12345', 'password123!', 'qwerty12345',
  'qwertyuiop', '1234567890', '12345678910', 'administrator', 'admin123456',
  'rajaklana123', 'rajaklana123!', 'rajaklana12345', 'demorajaklana123!'
]);

/** Local checks complement, but do not replace, the provider's breached-password check. */
export function newPasswordError(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) return 'Kata sandi harus 10–128 karakter';
  if (!value.trim() || /^(.)\1+$/u.test(value) || /^RK\d{6,}$/i.test(value)
    || common.has(value.toLowerCase())) return 'Kata sandi terlalu mudah ditebak. Gunakan kata sandi unik atau frasa yang lebih panjang.';
  return null;
}
