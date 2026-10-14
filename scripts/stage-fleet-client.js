'use strict';
require('../src/runtime/fleet-client-release').stage(require('path').resolve(__dirname,'..')).then(r=>console.log(JSON.stringify({build:r.build,files:r.files,action:'staged_only_no_process_restart'}))).catch(e=>{console.error(e.message);process.exitCode=1;});
