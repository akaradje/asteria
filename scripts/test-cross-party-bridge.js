'use strict';
require('child_process').execFileSync(process.platform==='win32'?'python':'python3',[require('path').join(__dirname,'test-cross-party-bridge.py')],{stdio:'inherit'});
