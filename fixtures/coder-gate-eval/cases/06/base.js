export function initials(name) {
  let parts = name.trim().split(/\s+/);
  return parts.map(p => p[0].toUpperCase()).join('');
}
