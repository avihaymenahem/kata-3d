// One-off probe: can headless Chromium give us a real WebGL2 context for offscreen capture?
import { chromium } from 'playwright';

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.setContent('<canvas id="c" width="640" height="360"></canvas>');
const info = await page.evaluate(() => {
  const c = document.getElementById('c');
  const gl = c.getContext('webgl2', { antialias: true });
  if (!gl) return { ok: false };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  gl.clearColor(0.1, 0.4, 0.9, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return {
    ok: true,
    version: gl.getParameter(gl.VERSION),
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a',
    maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxSamples: gl.getParameter(gl.MAX_SAMPLES),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
    colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
