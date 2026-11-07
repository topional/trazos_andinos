(() => {
  'use strict';
  const CATS = ['llama', 'sol', 'montana', 'chakana', 'cuy'];
  const $ = id => document.getElementById(id);
  const canvas = $('paint'), ctx = canvas.getContext('2d');
  const strokeWidth = $('stroke-width');
  let strokes = [], active = null, items = [], db = null, volatile = false, fallback = [], busy = false;
  const message = text => { $('message').textContent = text; };
  const timestamp = () => new Date().toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');
  const uniqueId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID() : Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);

  function draw() {
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#111'; ctx.fillStyle = '#111';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const { points, width } of strokes) {
      if (!points.length) continue;
      ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
      if (points.length === 1) {
        ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2); ctx.fill();
      } else {
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
      }
    }
  }
  strokeWidth.addEventListener('input', () => {
    $('stroke-width-value').textContent = strokeWidth.value + ' px';
    strokeWidth.setAttribute('aria-valuetext', strokeWidth.value + ' píxeles');
  });
  function point(e) {
    const r = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(512, (e.clientX-r.left)*512/r.width)),
             y: Math.max(0, Math.min(512, (e.clientY-r.top)*512/r.height)) };
  }
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); canvas.setPointerCapture(e.pointerId);
    active = [point(e)];
    strokes.push({ points: active, width: Number(strokeWidth.value) });
    draw(); message('');
  });
  canvas.addEventListener('pointermove', e => {
    if (!active) return;
    e.preventDefault(); const p = point(e), prev = active[active.length - 1];
    if (Math.hypot(p.x-prev.x, p.y-prev.y) > 0.6) { active.push(p); draw(); }
  });
  function end() { active = null; }
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => canvas.addEventListener(name, end));
  $('undo').addEventListener('click', () => { strokes.pop(); active = null; draw(); });
  $('clear').addEventListener('click', () => { strokes = []; active = null; draw(); message(''); });
  $('category').addEventListener('change', () => {
    strokes = []; active = null; draw(); message(''); highlightSelectedCategory();
  });

  function database() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('Sin IndexedDB'));
      const req = indexedDB.open('trazos_andinos_dataset', 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore('drawings', { keyPath: 'id' });
        store.createIndex('category', 'category');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  const request = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  function highlightSelectedCategory() {
    document.querySelectorAll('.counter-item').forEach(row => {
      row.classList.toggle('is-selected', row.dataset.category === $('category').value);
    });
  }
  async function reload() {
    items = volatile ? [...fallback] : await request(db.transaction('drawings', 'readonly').objectStore('drawings').getAll());
    $('total-count').textContent = items.length;
    const counts = Object.fromEntries(CATS.map(cat => [cat, 0]));
    for (const item of items) {
      if (Object.hasOwn(counts, item.category)) counts[item.category]++;
    }
    for (const cat of CATS) $('count-' + cat).textContent = counts[cat];
    highlightSelectedCategory();
  }
  async function store(item) {
    if (volatile) { fallback.push(item); return; }
    await request(db.transaction('drawings', 'readwrite').objectStore('drawings').put(item));
  }
  function pngBlob() {
    const output = document.createElement('canvas'); output.width = output.height = 256;
    const g = output.getContext('2d'); g.fillStyle = 'white'; g.fillRect(0, 0, 256, 256);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(canvas, 0, 0, 256, 256);
    return new Promise((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo crear el PNG')), 'image/png'));
  }
  $('save').addEventListener('click', async () => {
    if (busy) return;
    if (!strokes.length) return message('Primero realiza un dibujo.');
    busy = true; $('save').disabled = true;
    try {
      const category = $('category').value, id = uniqueId(), now = new Date().toISOString();
      const png = await pngBlob();
      const item = { id, category, created_at: now, filename: `${category}_${timestamp()}_${id.slice(-12).replace(/[^a-z0-9]/gi, '')}.png`, width: 256, height: 256, png };
      await store(item); strokes = []; active = null; draw(); await reload();
      message('Dibujo guardado. Puedes crear otro.');
    } catch (err) { console.error(err); message('Error al guardar: ' + err.message); }
    finally { busy = false; $('save').disabled = false; }
  });

  // ZIP sin librerías: imágenes PNG y archivo de etiquetas CSV.
  const encoder = new TextEncoder(); let crcTable;
  function crc32(bytes) {
    if (!crcTable) crcTable = Array.from({length:256}, (_, n) => { let c=n; for(let k=0;k<8;k++)c=c&1 ? 0xedb88320^(c>>>1) : c>>>1; return c>>>0; });
    let c=0xffffffff; for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8); return (c^0xffffffff)>>>0;
  }
  function writer(size) {
    const arr=new Uint8Array(size),v=new DataView(arr.buffer); let p=0;
    return {arr, u16(n){v.setUint16(p,n,true);p+=2}, u32(n){v.setUint32(p,n>>>0,true);p+=4}, bytes(b){arr.set(b,p);p+=b.length}};
  }
  function dateParts(d) { return { time:(d.getHours()<<11)|(d.getMinutes()<<5)|Math.floor(d.getSeconds()/2), date:((Math.max(1980,d.getFullYear())-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate() }; }
  async function makeZip(files) {
    const body=[],directory=[]; let offset=0;
    const {time,date}=dateParts(new Date());
    for (const f of files) {
      const name=encoder.encode(f.name), bytes=f.blob instanceof Blob?new Uint8Array(await f.blob.arrayBuffer()):encoder.encode(f.text||''),crc=crc32(bytes);
      const local=writer(30+name.length);
      local.u32(0x04034b50);local.u16(20);local.u16(0x0800);local.u16(0);local.u16(time);local.u16(date);
      local.u32(crc);local.u32(bytes.length);local.u32(bytes.length);local.u16(name.length);local.u16(0);local.bytes(name);
      body.push(local.arr,bytes);
      const central=writer(46+name.length);
      central.u32(0x02014b50);central.u16(20);central.u16(20);central.u16(0x0800);central.u16(0);
      central.u16(time);central.u16(date);central.u32(crc);central.u32(bytes.length);central.u32(bytes.length);
      central.u16(name.length);central.u16(0);central.u16(0);central.u16(0);central.u16(0);
      central.u32(f.name.endsWith('/') ? 0x10 : 0);central.u32(offset);central.bytes(name);
      directory.push(central.arr);offset+=local.arr.length+bytes.length;
    }
    const end=writer(22);end.u32(0x06054b50);end.u16(0);end.u16(0);end.u16(files.length);end.u16(files.length);
    end.u32(directory.reduce((n,b)=>n+b.length,0));end.u32(offset);end.u16(0);
    return new Blob([...body,...directory,end.arr],{type:'application/zip'});
  }
  const cell = value => '"'+String(value??'').replace(/"/g,'""')+'"';
  $('export').addEventListener('click', async () => {
    if (busy) return;
    if (!items.length) return message('Guarda al menos un dibujo antes de exportar.');
    busy=true; $('export').disabled=true; message('Preparando ZIP...');
    try {
      const files=CATS.map(name=>({name:name+'/'})), rows=['categoria,archivo,fecha_utc,ancho,alto'];
      for (const item of items) {
        files.push({name:item.category+'/'+item.filename,blob:item.png});
        rows.push([item.category,item.filename,item.created_at,item.width,item.height].map(cell).join(','));
      }
      files.push({name:'metadata.csv',text:'\ufeff'+rows.join('\r\n')+'\r\n'});
      files.push({name:'LEEME.txt',text:'TRAZOS ANDINOS\r\nCada imagen es un PNG de 256x256 pixeles con fondo blanco y trazo oscuro.\r\nCarpetas: llama, sol, montana, chakana, cuy.\r\nmetadata.csv contiene categoria, archivo, fecha_utc, ancho y alto.\r\nNo contiene nombres ni codigos de estudiantes.\r\nCada estudiante debe exportar su propio ZIP.\r\nCombinar las carpetas por categoria antes del entrenamiento.\r\nSeparar entrenamiento, validacion y prueba antes de entrenar.\r\n'});
      const zip=await makeZip(files),url=URL.createObjectURL(zip),link=document.createElement('a');
      link.href=url;link.download='dataset_andino_'+timestamp()+'.zip';document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      message(`ZIP exportado con ${items.length} dibujos.`);
    } catch (err) { console.error(err);message('Error al exportar: '+err.message); }
    finally { busy=false;$('export').disabled=false; }
  });
  $('deleteAll').addEventListener('click', async () => {
    if (!items.length) return;
    if (!confirm('¿Borrar todos los dibujos guardados? Exporta antes de continuar.')) return;
    try {
      if (volatile) fallback=[];
      else await request(db.transaction('drawings','readwrite').objectStore('drawings').clear());
      await reload();message('Se borraron todos los dibujos.');
    } catch (err) {message('No se pudo borrar: '+err.message);}
  });
  async function init() {
    draw();
    try { db=await database(); }
    catch (err) { console.warn(err); volatile=true;message('Aviso: este navegador no conserva los dibujos; exporta antes de cerrar.'); }
    await reload();
  }
  init();
})();
