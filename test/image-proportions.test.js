import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import {buildPptx} from '../src/adapters/pptx.js';
import {buildHtml} from '../src/adapters/html.js';
import {readProject} from '../src/core/project.js';

test('boundary images preserve landscape, portrait and square proportions without cropping', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pptops-image-proportions-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.cp(path.resolve('examples/demo-project'),root,{recursive:true});
  const project=await readProject(root);
  for (const [width,height] of [[1600,900],[600,1000],[800,800]]) {
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="gold"/></svg>`;
    await fs.writeFile(path.join(root,'assets','ratio.svg'),svg);
    project.assets=[{id:'ratio',type:'image',file:'assets/ratio.svg'}];
    project.pages.forEach(page=>{page.asset_slots=[{asset_id:'ratio',role:'hero',fit:'cover'}]});
    const file=path.join(root,`ratio-${width}-${height}.pptx`);
    await buildPptx(project,file);
    const zip=await JSZip.loadAsync(await fs.readFile(file));
    for(const number of [1,2]) {
      const xml=await zip.file(`ppt/slides/slide${number}.xml`).async('string');
      const pic=xml.match(/<p:pic\b[\s\S]*?<\/p:pic>/)[0];
      const extent=pic.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
      assert.ok(Math.abs(Number(extent[1])/Number(extent[2])-width/height)<0.00001,'native image aspect ratio must match source');
      const crop=pic.match(/<a:srcRect\b([^>]*)/);
      assert.ok(!crop || !/[ltrb]="[1-9]/.test(crop[1]),'boundary image must not crop to fill its slot');
    }
    const embedded=await Promise.all(Object.keys(zip.files).filter(name=>name.endsWith('.svg')).map(name=>zip.file(name).async('string')));
    assert.ok(embedded.includes(svg),'source image is preserved');
    const html=await buildHtml(project);
    assert.equal((html.match(/--fit:cover/g)??[]).length,0);
    assert.equal((html.match(/--fit:contain/g)??[]).length,2);
  }
});
