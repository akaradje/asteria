'use strict';
const cores=['Ancient Bark','Pharaoh Gold','Wyrm Scale','Tyrant Ember','Abyss Crystal'];
function reserve(save,world){
 const upkeep=Math.max(1000,(save.lv||1)*100);
 const high=Object.values(world?.HIGH_CLASSES||{}).some(c=>c.from===save.job);
 return upkeep+(high?Number(world?.ASCEND?.coins||100000):0);
}
module.exports={reserve,cores};
