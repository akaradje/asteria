'use strict';

const path = require('path');
const fs = require('fs');

function loadMachineArgs(args = process.argv.slice(2), platform = process.platform) {
  const cli = Object.fromEntries(args.map(a => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
  }));
  if (!cli.machine) return cli; // Existing diagnostic commands remain compatible.
  if (!['windows', 'tum', 'vps'].includes(cli.machine)) throw new Error('Use --machine=windows, --machine=tum or --machine=vps');
  const file = path.resolve(__dirname, '..', 'machines', cli.machine, 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (config.platform !== platform) throw new Error(`Machine ${cli.machine} requires ${config.platform}, got ${platform}`);
  return { ...config.args, ...cli };
}

module.exports = { loadMachineArgs };
