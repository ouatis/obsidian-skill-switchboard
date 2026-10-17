import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import esbuild from 'esbuild';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tempRoot=await fs.mkdtemp(path.join(os.tmpdir(),'skill-switchboard-readiness-'));
const vault=path.join(tempRoot,'vault');
const source=path.join(vault,'knowledge','team-skills');
const manifestPath=path.join(vault,'config','agent-skills.json');
const toolkit=path.join(source,'packages','drawing');
const sha=text=>createHash('sha256').update(text).digest('hex');
const files={'SKILL.md':'# Toolkit\n','kit.mjs':'export const version=1;\n'};
const inventory={schema_version:1,files:Object.entries(files).map(([path,text])=>({path,sha256:sha(text)}))};
const card=(packagePath='packages/drawing',manifest='packages/drawing.json')=>`---\nname: drawing\ndescription: Draw diagrams.\npackage_path: ${packagePath}\n${manifest?'package_manifest: '+manifest+'\n':''}---\n\n# Drawing\n`;
const adapter={codex:{display_name:'Drawing',short_description:'Draw diagrams',default_prompt:'Use $drawing'},hermes:{},workbuddy:true,opencode:{},antigravity:true,dsh:{}};
const manifest={schema_version:1,total_skills:1,skills:[{name:'drawing',shared_file:'knowledge/team-skills/drawing.md',adapters:adapter}]};
async function write(file,text){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text);}
try{
    for(const entry of ['sync/manifest','sync/source','sync/freshness','sync/native-repair','sync/package-paths','ui/repair-summary','sync-provider']){
        await esbuild.build({entryPoints:[path.join(repo,'src',entry+'.ts')],bundle:true,platform:'node',format:'cjs',outfile:path.join(tempRoot,entry.replaceAll('/','-')+'.cjs'),logLevel:'silent'});
    }
    const load=entry=>import(pathToFileURL(path.join(tempRoot,entry.replaceAll('/','-')+'.cjs')).href);
    const native=await load('sync/manifest'),sources=await load('sync/source'),repair=await load('sync/native-repair');
    const {NativeSyncProvider}=await load('sync-provider');
    const localPackages=await load('sync/package-paths');
    const {CheckFreshness}=await load('sync/freshness');
    const {repairTotals}=await load('ui/repair-summary');
    const config={roots:[{id:'other',kind:'vault',enabled:true,path:'unrelated'},{id:'team',kind:'vault',enabled:true,path:'knowledge/team-skills'}],syncRootId:'team',syncManifestPath:'config/agent-skills.json',targets:[]};
    const location=sources.resolveSyncSource(vault,config);
    assert.deepEqual(location,{sharedRoot:source,manifestPath,confineToVault:true});
    assert.equal(sources.resolveSyncSource(vault,{...config,syncManifestPath:''}).manifestPath,path.join(vault,'knowledge','skills-manifest.json'));
    assert.throws(()=>sources.resolveSyncSource(vault,{...config,syncRootId:'missing'}),/Choose/);
    assert.throws(()=>sources.resolveSyncSource(vault,{roots:[{id:'bad',kind:'vault',enabled:true,path:'../outside'}],syncRootId:'bad'}),/stay inside/);
    assert.notEqual(sources.settingsCheckKey(config),sources.settingsCheckKey({...config,syncManifestPath:'new.json'}));
    await write(manifestPath,JSON.stringify(manifest));await write(path.join(source,'drawing.md'),card());
    for(const [name,text] of Object.entries(files))await write(path.join(toolkit,name),text);
    await write(path.join(toolkit,'.github','metadata.md'),'Repository maintenance only');
    await write(path.join(source,'packages','drawing.json'),JSON.stringify(inventory));
    const inspect=()=>native.inspectManifest(vault,location);
    let checked=await inspect();assert.equal(checked.status,'passed');assert.equal(checked.resources.status,'passed');assert.equal(checked.resources.packages[0].verifiedFiles,2);assert.equal(checked.resources.crossDevice,'unverified');
    const target=path.join(tempRoot,'runtime-codex');
    const first=await repair.repairRuntimeNative(vault,'codex',target,checked.snapshot,{backupRoot:path.join(tempRoot,'backup')});
    assert.equal(first.status,'passed');assert.deepEqual(first.changedSkills,['drawing']);assert.equal(first.changes.length,2);
    const wrapper=await fs.readFile(path.join(target,'drawing','SKILL.md'),'utf8');assert(wrapper.includes('knowledge/team-skills/drawing.md'));assert(!wrapper.includes('00-MEMORTE'));assert(!wrapper.includes('JARDIN'));
    const second=await repair.repairRuntimeNative(vault,'codex',target,checked.snapshot);assert.equal(second.writtenFiles,0);assert.deepEqual(second.changedSkills,[]);
    const provider=new NativeSyncProvider(()=>location);
    await fs.unlink(path.join(toolkit,'kit.mjs'));
    checked=await inspect();assert.equal(checked.resources.status,'failed');assert(checked.resources.packages[0].issues.some(i=>i.code==='missing'&&i.path==='kit.mjs'));
    const refused=await provider.repairRuntime(vault,'codex',path.join(tempRoot,'never-written'));assert.equal(refused.status,'failed');assert.equal(await fs.access(path.join(tempRoot,'never-written')).then(()=>true,()=>false),false);
    await write(path.join(toolkit,'kit.mjs'),'changed\n');assert((await inspect()).resources.packages[0].issues.some(i=>i.code==='changed'));
    await write(path.join(toolkit,'kit.mjs'),files['kit.mjs']);await write(path.join(toolkit,'extra.mjs'),'extra');assert((await inspect()).resources.packages[0].issues.some(i=>i.code==='unexpected'));
    await fs.unlink(path.join(toolkit,'extra.mjs'));
    await write(path.join(source,'drawing.md'),card('packages/drawing',''));checked=await inspect();assert.equal(checked.resources.status,'warning');assert(checked.resources.packages[0].issues.some(i=>i.code==='unverified'));
    const hiddenToolkit=path.join(source,'.hidden','drawing');await fs.rename(toolkit,hiddenToolkit).catch(async()=>{await fs.mkdir(path.dirname(hiddenToolkit),{recursive:true});await fs.rename(toolkit,hiddenToolkit);});
    await write(path.join(source,'drawing.md'),card('.hidden/drawing'));checked=await inspect();assert.equal(checked.resources.status,'warning');assert(checked.resources.packages[0].issues.some(i=>i.code==='hidden-path'));
    await fs.rename(hiddenToolkit,toolkit);await write(path.join(source,'drawing.md'),card());
    for(const invalid of ['../outside','/outside','C:\\outside','packages/../../outside']){
        await write(path.join(source,'packages','drawing.json'),JSON.stringify({...inventory,files:[{path:invalid,sha256:sha('x')}]}));assert.equal((await inspect()).resources.status,'failed',invalid);
    }
    await write(path.join(source,'packages','drawing.json'),JSON.stringify({...inventory,files:[inventory.files[0],inventory.files[0]]}));assert.equal((await inspect()).resources.status,'failed');
    await write(path.join(source,'packages','drawing.json'),JSON.stringify(inventory));
    await write(manifestPath,JSON.stringify({...manifest,adapter_defaults:{hermes:{category:'team'}}}));checked=await inspect();assert.equal(checked.snapshot.skills[0].adapters.hermes.category,'team');
    const external=path.join(tempRoot,'external-project','skills');await fs.cp(source,external,{recursive:true});
    const externalManifest=path.join(tempRoot,'external-manifest.json');await write(externalManifest,JSON.stringify({...manifest,skills:[{...manifest.skills[0],shared_file:'drawing.md'}]}));
    checked=await native.inspectManifest(vault,{sharedRoot:external,manifestPath:externalManifest});assert.equal(checked.status,'passed');assert.equal(checked.snapshot.sharedPrefix,'');assert.equal(checked.resources.status,'passed');
    // External toolkits retain a shared card + fixed inventory, but paths are device-local.
    const registryPath=path.join(tempRoot,'local-only','packages.json');
    const externalLocation={...location,packageRegistryPath:registryPath};
    const externalInspect=()=>native.inspectManifest(vault,externalLocation);
    const externalCard=card().replace('package_path: packages/drawing','package_id: drawing');
    const externalToolkit=path.join(tempRoot,'toolkits','drawing');
    await fs.mkdir(path.dirname(externalToolkit),{recursive:true});await fs.rename(toolkit,externalToolkit);
    await write(path.join(source,'drawing.md'),externalCard);
    checked=await externalInspect();assert.equal(checked.resources.status,'failed');assert(checked.resources.packages[0].issues.some(i=>i.code==='unconfigured'));
    assert.equal(await fs.access(registryPath).then(()=>true,()=>false),false,'read-only checks do not create a registry');
    assert.deepEqual(await localPackages.readLocalPackagePaths(registryPath),{});
    await localPackages.saveLocalPackagePath('other',path.join(tempRoot,'other-toolkit'),registryPath);
    await localPackages.saveLocalPackagePath('drawing',externalToolkit,registryPath);
    assert.equal((await localPackages.readLocalPackagePaths(registryPath)).drawing,externalToolkit);
    checked=await externalInspect();assert.equal(checked.resources.status,'passed');assert.equal(checked.resources.packages[0].location,'external');assert.equal(checked.resources.packages[0].path,await fs.realpath(externalToolkit));assert.equal(checked.resources.packages[0].verifiedFiles,2);
    await write(path.join(external,'drawing.md'),externalCard);
    const externalSourceLocation={sharedRoot:external,manifestPath:externalManifest,packageRegistryPath:registryPath};
    for(const overlappingRoot of [path.dirname(external),tempRoot]){
        await localPackages.saveLocalPackagePath('drawing',overlappingRoot,registryPath);
        const overlapCheck=await native.inspectManifest(vault,externalSourceLocation);
        assert.equal(overlapCheck.resources.status,'failed','an external package may not contain its vault or canonical source');
        assert.equal(overlapCheck.resources.packages[0].files,0,'overlapping package roots are rejected before walking files');
    }
    await localPackages.saveLocalPackagePath('drawing',externalToolkit,registryPath);
    await fs.unlink(path.join(externalToolkit,'kit.mjs'));checked=await externalInspect();assert.equal(checked.resources.status,'failed');
    const externalProvider=new NativeSyncProvider(()=>externalLocation);
    const externalRefusal=await externalProvider.repairRuntime(vault,'codex',path.join(tempRoot,'external-never-written'));assert.equal(externalRefusal.status,'failed');assert.equal(await fs.access(path.join(tempRoot,'external-never-written')).then(()=>true,()=>false),false);
    await write(path.join(externalToolkit,'kit.mjs'),files['kit.mjs']);
    await write(path.join(source,'drawing.md'),externalCard.replace('package_id: drawing','package_id: drawing\npackage_path: packages/drawing'));assert.equal((await externalInspect()).resources.status,'failed','dual declarations are rejected');
    await write(path.join(source,'drawing.md'),externalCard);
    await localPackages.saveLocalPackagePath('drawing',source,registryPath);assert.equal((await externalInspect()).resources.status,'failed','an external package may not resolve into the vault');
    const sourceAlias=path.join(tempRoot,'source-alias');await fs.symlink(source,sourceAlias,'dir');
    await localPackages.saveLocalPackagePath('drawing',sourceAlias,registryPath);checked=await externalInspect();assert.equal(checked.resources.status,'failed','an external package symlink may not resolve into the vault');
    for(const value of ['relative/drawing','../outside','https://example.com/toolkit','\0'])await assert.rejects(()=>localPackages.saveLocalPackagePath('drawing',value,registryPath));
    await assert.rejects(()=>localPackages.saveLocalPackagePath('../drawing',externalToolkit,registryPath));
    await localPackages.saveLocalPackagePath('drawing','',registryPath);assert.equal((await localPackages.readLocalPackagePaths(registryPath)).drawing,undefined);assert((await localPackages.readLocalPackagePaths(registryPath)).other);
    await write(registryPath,JSON.stringify({schema_version:99,packages:{}}));await assert.rejects(()=>localPackages.readLocalPackagePaths(registryPath));assert.equal((await externalInspect()).resources.status,'failed');
    await write(registryPath,JSON.stringify({schema_version:1,packages:{drawing:true}}));await assert.rejects(()=>localPackages.readLocalPackagePaths(registryPath));
    await write(registryPath,JSON.stringify({schema_version:1,packages:{drawing:externalToolkit}}));assert.equal((await externalInspect()).resources.status,'passed');
    const freshness=new CheckFreshness();assert.equal(freshness.stale,true);const token=freshness.capture();assert(freshness.accept(token));freshness.invalidate();assert(freshness.stale);assert(!freshness.accept(token));assert(freshness.accept(freshness.capture()));
    const detail=(id,skills,count)=>({targetId:id,label:id,runtime:'codex',repair:{native:{writtenFiles:count,replacedDirectories:0,changedSkills:skills,changes:[]}}});
    assert.deepEqual(repairTotals({details:[detail('a',['x','y'],2),detail('b',['y','z'],3)],repairedCount:2}),{targets:2,skills:3,files:5});
    assert.deepEqual(repairTotals({details:[{repair:{}}],repairedCount:1}),{targets:1,skills:null,files:null});
    console.log('Readiness checks passed: configurable sources, portable wrappers, inventories, corruption/write refusal, machine-local external packages, symlink confinement, missing mappings, invalid registries/paths, adapter defaults, stale-result rejection, and structured repair totals.');
}finally{
    assert.equal(path.dirname(await fs.realpath(tempRoot)),await fs.realpath(os.tmpdir()));assert(path.basename(tempRoot).startsWith('skill-switchboard-readiness-'));
    await fs.rm(tempRoot,{recursive:true,force:true});
}
