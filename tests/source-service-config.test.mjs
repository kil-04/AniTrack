import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

registerHooks({load(url,context,next){
  if(url.endsWith('/apps/source-service/config.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};
  return next(url,context);
}});
const {sourceServiceConfig}=await import('../apps/source-service/config.ts');
const profile=path.resolve('artifacts/web-qa/config-fixture-profile');
const valid={SOURCE_SERVICE_KEY:'service_fixture_'.repeat(3),SOURCE_OPERATOR_KEY:'operator_fixture_'.repeat(3),SOURCE_OPERATOR_ORIGIN:'https://source.example',SOURCE_PROFILE_DIR:profile};

test('Production bind and port defaults remain explicit; local checks can bind only loopback',()=>{
  assert.deepEqual(sourceServiceConfig(valid),{key:valid.SOURCE_SERVICE_KEY,operatorKey:valid.SOURCE_OPERATOR_KEY,operatorOrigin:valid.SOURCE_OPERATOR_ORIGIN,profileDir:profile,bindAddress:'0.0.0.0',port:8080});
  assert.equal(sourceServiceConfig({...valid,SOURCE_BIND_ADDRESS:'127.0.0.1',PORT:'4189'}).bindAddress,'127.0.0.1');
  for(const address of ['', 'localhost','::1','127.0.0.2','192.168.1.1','0.0.0.0 ','https://source.example','127.0.0.1\n'])assert.throws(()=>sourceServiceConfig({...valid,SOURCE_BIND_ADDRESS:address}),/SOURCE_BIND_ADDRESS/);
});
test('Ports reject malformed, zero and out-of-range values instead of relying on numeric coercion',()=>{
  for(const port of ['1','65535'])assert.equal(sourceServiceConfig({...valid,PORT:port}).port,Number(port));
  for(const port of ['', '0','65536','-1','1.5','NaN','Infinity','0x1f90','8e3',' 8080','8080 ','08080'])assert.throws(()=>sourceServiceConfig({...valid,PORT:port}),/PORT/);
});
test('Both startup keys are bounded random-key strings and cannot be reused',()=>{
  for(const name of ['SOURCE_SERVICE_KEY','SOURCE_OPERATOR_KEY'])for(const key of [undefined,'','x'.repeat(31),'x'.repeat(257),'x'.repeat(32)+' ','秘密'.repeat(32),'x'.repeat(32)+'\n'])assert.throws(()=>sourceServiceConfig({...valid,[name]:key}),new RegExp(name));
  assert.throws(()=>sourceServiceConfig({...valid,SOURCE_OPERATOR_KEY:valid.SOURCE_SERVICE_KEY}),/different keys/);
  for(const length of [32,256])assert.equal(sourceServiceConfig({...valid,SOURCE_SERVICE_KEY:'a'.repeat(length),SOURCE_OPERATOR_KEY:'b'.repeat(length)}).key.length,length);
});
test('Operator origin remains an exact HTTPS origin before any startup side effect',()=>{
  for(const origin of [undefined,'','http://source.example','https://source.example/','https://source.example/path','https://source.example?key=private','https://source.example#fragment','https://user:private@source.example',' https://source.example'])assert.throws(()=>sourceServiceConfig({...valid,SOURCE_OPERATOR_ORIGIN:origin}),/SOURCE_OPERATOR_ORIGIN/);
});

test('A new Render service can use its assigned HTTPS origin before a custom origin is configured',()=>{
  const env={...valid,SOURCE_OPERATOR_ORIGIN:undefined,RENDER_EXTERNAL_URL:'https://anitrack-source-fixture.onrender.com'};
  assert.equal(sourceServiceConfig(env).operatorOrigin,env.RENDER_EXTERNAL_URL);
  assert.equal(sourceServiceConfig({...env,SOURCE_OPERATOR_ORIGIN:'https://custom.example'}).operatorOrigin,'https://custom.example');
  for(const origin of ['http://unsafe.example','https://user:secret@unsafe.example','https://source.example/path'])assert.throws(()=>sourceServiceConfig({...env,RENDER_EXTERNAL_URL:origin}),/SOURCE_OPERATOR_ORIGIN/);
  assert.throws(()=>sourceServiceConfig({...env,SOURCE_OPERATOR_ORIGIN:''}),/SOURCE_OPERATOR_ORIGIN/);
});
test('A dedicated profile cannot be relative, a filesystem root, home, app-data, or an existing desktop profile',()=>{
  const home=path.resolve('artifacts/web-qa/home'),appData=path.join(home,'appdata'),desktop=path.join(appData,'AniTrack');
  const boundaries={reservedDirectories:[home,appData],reservedRoots:[desktop]};
  for(const candidate of [undefined,'','relative/profile',path.parse(profile).root,home,appData,desktop,path.join(desktop,'sessions'),path.join(desktop,'..','AniTrack','cache'),profile+'\n'])assert.throws(()=>sourceServiceConfig({...valid,SOURCE_PROFILE_DIR:candidate},boundaries),/SOURCE_PROFILE_DIR/);
  const separate=path.join(home,'service-profile');assert.equal(sourceServiceConfig({...valid,SOURCE_PROFILE_DIR:separate},boundaries).profileDir,separate);
});
test('A dedicated ephemeral profile is accepted without requiring a persistent volume',()=>{
  const temporary=path.join(os.tmpdir(),'anitrack-source-profile');
  assert.equal(sourceServiceConfig({...valid,SOURCE_PROFILE_DIR:temporary}).profileDir,path.resolve(temporary));
});
test('Configuration errors never repeat secret values or sensitive profile paths',()=>{
  const secret='private value '+'x'.repeat(40),privatePath='relative/private-profile';
  for(const env of [{...valid,SOURCE_SERVICE_KEY:secret},{...valid,SOURCE_OPERATOR_ORIGIN:'https://user:password@source.example'},{...valid,SOURCE_PROFILE_DIR:privatePath}]){
    let message='';try{sourceServiceConfig(env);}catch(error){message=error.message;}
    assert.ok(message);for(const privateValue of [secret,'password',privatePath])assert.ok(!message.includes(privateValue));
  }
});
