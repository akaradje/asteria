'use strict';
// Only dismiss informational news. Never touch trade/payment/reward dialogs.
async function dismissStartupNews(actor){
 return actor.eval(`(() => {
  const p=document.getElementById('panel'),b=document.getElementById('pBody'),c=document.getElementById('pClose');
  if(!p||p.hidden||b?.dataset?.panel!=='news'||!c||c.disabled)return false;
  c.click();return p.hidden===true;
 })()`);
}
module.exports={dismissStartupNews};
