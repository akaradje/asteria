'use strict';
const fs=require('fs'),{execFileSync}=require('child_process'),fleet=require('../machines/fleet.json');
const args=process.argv.slice(2),at=args.indexOf('--target'),target=at>=0?args[at+1]?.trim():null;
if(!target||target.length>32)throw Error('Usage: node scripts/start-pvp-mission.js --target "exact character name"');
const ownNames=['ExampleAccount2','ExampleAccount8','ExampleAccount10','ExampleAccount4','ExampleAccount6','ExampleAccount12'];if(ownNames.includes(target))throw Error('Target belongs to this team');
const c={version:1,id:'human-pvp-'+Date.now(),target,ownNames,expiresAt:Date.now()+900000,requestedBy:'human CLI',evidence:'explicit operator target'};
fs.writeFileSync('logs/pvp-command.json',JSON.stringify(c,null,2));execFileSync('scp',['-q','logs/pvp-command.json',fleet.ssh.host+':/opt/asteria-node-a/asteria/logs/pvp-command.json'],{windowsHide:true,timeout:30000});
console.log('PvP command sent to Windows + tum: '+target+'; maximum 10 minutes in field, two deaths per character.');
// Ensure the opt-in client adapter is present, including after a normal farm recycle.
require('./deploy-campaign-release');
