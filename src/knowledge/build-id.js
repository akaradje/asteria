'use strict';
// Preserve the complete server identity, including deployment metadata. A plus
// is a literal safe filename character, never permission to alias two builds.
function valid(value,max=80){return typeof value==='string'&&value.length<=max&&/^[A-Za-z0-9_-]+(?:\+[A-Za-z0-9_-]+)?$/.test(value);}
function hashBuild(value){return valid(value)&&/^[a-f0-9]{7,64}(?:\+[A-Za-z0-9_-]{1,16})?$/.test(value);}
module.exports={valid,hashBuild};
