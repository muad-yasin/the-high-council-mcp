// A loopback stub answers a judge's request from a SCRIPT. Once the verdict envelope sentence is recorded in src/roles.js (the 0.8.3 apply), every judge prompt carries `review_id "<id>" and draft_id "<id>"` and a reply that does not carry
// both back is counted as an abstention, so a scripted reply has to echo them like a real model does. echoIds(requestBody, replyText) -> the reply with the two ids added when the request holds them and the reply is a JSON object;
// anything else (the decider's ruling, a criteria reply, a prompt without the section) comes back unchanged. Test data only.
const IDS = /review_id "([^"]+)" and draft_id "([^"]+)"/;
export function echoIds(requestBody, replyText) {
  let user = '';
  try { const b = JSON.parse(requestBody || '{}'); user = (b.messages ?? []).map(m => (typeof m.content === 'string' ? m.content : '')).join('\n'); } catch { return replyText; }
  const m = IDS.exec(user);
  if (!m) return replyText;
  try { const o = JSON.parse(replyText); return o && typeof o === 'object' && !Array.isArray(o) ? JSON.stringify({ ...o, review_id: m[1], draft_id: m[2] }) : replyText; } catch { return replyText; }
}
