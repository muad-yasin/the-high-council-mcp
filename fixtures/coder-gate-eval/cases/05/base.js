export function nameLength(user) {
  if (!user || typeof user.name !== 'string') return 0;
  return user.name.length;
}
