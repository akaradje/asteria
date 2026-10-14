'use strict';
// Bounds and gates from client build 957eabb FIELD / FIELD_GATES / TOWN.
// Unknown/instanced rooms deliberately have no assumed geometry.
const FIELD = { x0: -58, x1: 33, z0: -49, z1: 58 };
const TOWN = { x0: 110, x1: 210, z0: -47, z1: 42 };
function mapCatalog(wiki) {
  return [{ id: 'town', name: 'Asteria Town', region: 'เมืองกลาง', bounds: TOWN, gates: [] },
    ...(wiki.maps.maps || []).map(m => ({ id: m.id, name: m.name, region: m.region,
      levelMin: m.levelMin, levelMax: m.levelMax, next: m.connectsTo?.next || null,
      bounds: FIELD, gates: [{ x: 0, z: 40, label: 'กลับเมือง' },
        ...(m.connectsTo?.prev ? [{ x: -38, z: -2, label: m.connectsTo.prev }] : []),
        ...(m.connectsTo?.next ? [{ x: 16, z: -42, label: m.connectsTo.next }] : [])] }))];
}
function positionOf(instance, now = Date.now()) {
  const p = instance.livePos;
  const valid = p && typeof p.room === 'string' && p.room.length > 0 && Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.at);
  return { slot: instance.slot, name: instance.character?.name || `จอ ${instance.slot}`,
    status: instance.status, job: instance.lastSave?.job || null,
    goal: instance.goal?.label || null, goalMap: instance.goal?.mapId || null,
    room: valid ? p.room : null, x: valid ? p.x : null, z: valid ? p.z : null,
    at: valid ? p.at : null, moving: !!(valid && p.mv), dead: !!(valid && p.dead),
    stale: !valid || now - p.at > 10000 || instance.status !== 'playing' };
}
module.exports = { mapCatalog, positionOf };
