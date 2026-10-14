'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=require('../src/knowledge/system-version').inventory(root).revision;
const build=JSON.parse(fs.readFileSync(path.join(root,'machines/fleet-client-release.json'))).build;
const file=path.join(root,'logs/system-audit/brain-acceptance-claims.json');let claims=[];if(fs.existsSync(file))claims=JSON.parse(fs.readFileSync(file)).claims;
const report=require('../src/observability/brain-delivery').report(root,claims,{sourceRevision:source,build});
const output=path.join(root,'logs/system-audit/brain-delivery-current.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({file:output,packages:report.packages.length,cases:report.cases.length,nativePassed:report.nativePassed,offlineOnly:report.offlineOnly,complete:report.complete}));
