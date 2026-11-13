import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import esbuild from 'esbuild';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot=await fs.mkdtemp(path.join(os.tmpdir(), 'skill-switchboard-scanner-'));
const root={id:'source',label:'Source',path:'skills',kind:'vault',enabled:true};
const card=(name,metadata='')=>`---\nname: ${name}\ndescription: ${name} skill\n${metadata}---\n\n# ${name}\n`;
const documents={
    'skills/diagram.md':card('diagram','package_path: "./packages/toolkit/"\n'),
    'skills/plain.md':card('plain'),
    'skills/self.md':card('self','package_path: self.md\n'),
    'skills/packages/toolkit/SKILL.md':card('upstream-duplicate'),
    'skills/packages/toolkit/examples/SKILL.md':card('example-duplicate'),
    'skills/packages/toolkit/README.md':'Dependency documentation',
    'skills/packages/toolkit-sibling/SKILL.md':card('prefix-sibling'),
    'skills/packages/undeclared/SKILL.md':card('undeclared-package'),
    'skills/installed/SKILL.md':card('installed'),
    'skills/references/support.md':'Not a skill',
    'elsewhere/SKILL.md':card('outside-root'),
};
const names=['diagram','installed','plain','prefix-sibling','self','undeclared-package'];
const mockApp=(data,reads)=>({vault:{
    getMarkdownFiles:()=>Object.keys(data).map(p=>({path:p,name:path.posix.basename(p)})),
    read:async file=>{reads.push(file.path);return data[file.path];},
    adapter:{getBasePath:()=>tempRoot},
}});
try{
    const bundle=path.join(tempRoot,'scanner.cjs');
    await esbuild.build({entryPoints:[path.join(repo,'src/scanner.ts')],bundle:true,platform:'node',format:'cjs',outfile:bundle,external:['obsidian','node:*'],logLevel:'silent'});
    const {scanConfiguredRoots}=await import(pathToFileURL(bundle).href);
    const reads=[];
    const vault=await scanConfiguredRoots(mockApp(documents,reads),[root]);
    assert.deepEqual(vault.errors,[]);
    assert.deepEqual(vault.skills.map(s=>s.name).sort(),names);
    assert(!reads.some(p=>p.startsWith('skills/packages/toolkit/')),'never read dependency skill bodies');
    assert.equal(reads.filter(p=>p==='skills/diagram.md').length,1,'read each canonical card once');

    for(const [relative,content] of Object.entries(documents)){
        const file=path.join(tempRoot,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content);
    }
    const external=await scanConfiguredRoots(mockApp({},[]),[{...root,kind:'external'}]);
    assert.deepEqual(external.errors,[]);
    assert.deepEqual(external.skills.map(s=>s.name).sort(),names);
    const windows=await scanConfiguredRoots(mockApp({...documents,'skills/diagram.md':card('diagram','package_path: packages\\toolkit\n')},[]),[root]);
    assert.deepEqual(windows.skills.map(s=>s.name).sort(),names,'portable separators');
    for(const bad of ['.','..','../outside','packages/../../outside','/absolute','C:/outside','C:\\outside','\\\\server\\share','https://example.com/pkg','~/outside']){
        const invalid={...documents,'skills/diagram.md':card('diagram',`package_path: ${bad}\n`)};
        const result=await scanConfiguredRoots(mockApp(invalid,[]),[root]);
        assert.equal(result.errors.length,1,bad);assert.match(result.errors[0],/Invalid package_path/);
        await fs.writeFile(path.join(tempRoot,'skills/diagram.md'),invalid['skills/diagram.md']);
        const desktop=await scanConfiguredRoots(mockApp({},[]),[{...root,kind:'external'}]);
        assert.equal(desktop.errors.length,1,bad);assert.match(desktop.errors[0],/Invalid package_path/);
    }
    console.log('Scanner checks passed: vault/external roots, declared resource exclusion, unchanged undeclared skills, prefix boundaries, single card reads, portable paths, and invalid-path diagnostics.');
}finally{
    assert.equal(path.dirname(await fs.realpath(tempRoot)),await fs.realpath(os.tmpdir()));
    assert(path.basename(tempRoot).startsWith('skill-switchboard-scanner-'));
    await fs.rm(tempRoot,{recursive:true,force:true});
}
