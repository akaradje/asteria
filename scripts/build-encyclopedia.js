'use strict';
const root=require('path').resolve(__dirname,'..'),economy=require('../src/economy'),service=require('../src/knowledge/mastery-service');
const build=process.argv.find(a=>a.startsWith('--build='))?.slice(8)||economy.newestBuild(root);
const book=service.getBook(root,build);console.log(JSON.stringify(service.summary(book)));
