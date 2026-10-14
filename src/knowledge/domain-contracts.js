'use strict';
const dependencies={travel:['routes'],investment:['worldTables','investment','client'],boss:['bossMechanics'],combat:['worldTables','bossMechanics'],class:['worldTables','client'],craft:['worldTables','investment','client'],quests:['worldTables','client'],transport:['network']};
function compare(previous,current){return Object.fromEntries(Object.entries(dependencies).map(([domain,fields])=>{const complete=fields.every(k=>typeof previous?.[k]==='string'&&typeof current?.[k]==='string');const changed=fields.filter(k=>previous?.[k]!==current?.[k]);return [domain,{fields,complete,changed,state:!complete?'unknown':changed.length?'review_required':'compatible',authorizesActions:false}];}));}
module.exports={dependencies,compare};
