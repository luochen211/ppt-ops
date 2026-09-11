import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { validateDiagram, compileDiagram } from '../src/layout/diagram.js';
import { buildPptx } from '../src/adapters/pptx.js';
import { buildHtml } from '../src/adapters/html.js';
import { readProject } from '../src/core/project.js';
const diagram = {nodes:[{id:'request',text:'请求 <核验>',role:'input',x:0,y:.3,w:.3,h:.3},{id:'gate',text:'条件',role:'condition',x:.6,y:.3,w:.3,h:.3}],edges:[{from:'request',to:'gate',label:'核验'}]};
test('relation diagrams reject broken references, duplicate identifiers and overflowing bounds', () => {
  assert.deepEqual(validateDiagram(diagram),[]);
  for(const mutate of [d=>d.edges[0].to='missing',d=>d.nodes[1].id='request',d=>d.nodes[0].x=.9,d=>d.nodes[0]=null,d=>d.edges[0]=null]) {
    const invalid=structuredClone(diagram);mutate(invalid);assert.ok(validateDiagram(invalid).length);assert.throws(()=>compileDiagram(invalid),{code:'DIAGRAM_INVALID'});
  }
  assert.deepEqual(compileDiagram(diagram).edges[0].start,{x:.3,y:.44999999999999996});
});
test('relation diagram uses editable native text and arrows while preserving non-target slides',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pptops-diagram-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.cp(path.resolve('examples/demo-project'),root,{recursive:true});
  const project=await readProject(root);project.pages.splice(1,0,{...structuredClone(project.pages[0]),page:2});project.pages[2].page=3;
  const baseline=path.join(root,'baseline.pptx');await buildPptx(project,baseline);
  project.pages[1].screen_text.body=[];project.pages[1].asset_slots=[];project.pages[1].diagram=diagram;
  const modified=path.join(root,'diagram.pptx');await buildPptx(project,modified);
  const [before,after]=await Promise.all([baseline,modified].map(async file=>JSZip.loadAsync(await fs.readFile(file))));
  for(const n of [1,3]) assert.equal(await before.file(`ppt/slides/slide${n}.xml`).async('string'),await after.file(`ppt/slides/slide${n}.xml`).async('string'));
  const xml=await after.file('ppt/slides/slide2.xml').async('string');assert.match(xml,/Diagram connector request to gate/);assert.match(xml,/请求 &lt;核验&gt;/);assert.match(xml,/prst="diamond"/);assert.match(xml,/tailEnd type="triangle"/);
  const html=await buildHtml(project);assert.match(html,/class="relation-diagram"/);assert.match(html,/请求 &lt;核验&gt;/);assert.doesNotMatch(html,/请求 <核验>/);
});
