// Must match exactly what the mobile app displays/expects — do not change this format.
export const generateDefaultPassword = (email: string): string => {
  const local = email.split('@')[0] || '';
  return local.charAt(0).toUpperCase() + local.slice(1) + '@12345';
};
