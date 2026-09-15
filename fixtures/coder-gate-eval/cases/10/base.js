async function load(id) {
  return { id, ok: true };
}
export async function isOk(id) {
  const record = await load(id);
  return record.ok === true;
}
