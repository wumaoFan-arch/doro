// Builds cat-rheology.html: the anatomy kit + lathe inlined, then scene.js.
// Usage: node build.mjs <path-to-anatomy-skill> [--preview]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = process.argv[2];
if (!SKILL) throw new Error("pass the anatomy skill directory");
const kit = await import(join(SKILL, "kit/iso-kit.mjs"));
const strip = (file) => readFileSync(join(SKILL, "kit", file), "utf8").replace(/^import .*$/gm, "").replace(/^export /gm, "");
const latheSrc = readFileSync(join(SKILL, "kit/lathe.mjs"), "utf8");
const latheNames = [...latheSrc.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]);
// lathe.mjs shares helper names with the kit, so it gets its own scope as G
const lathe = `const G = (() => {${latheSrc.replace(/^import .*$/gm, "").replace(/^export /gm, "")}\nreturn { ${latheNames.join(", ")} };})();`;
const script = strip("iso-kit.mjs") + "\n" + lathe + "\n" + readFileSync(join(HERE, "scene.js"), "utf8");

// The kit ships dark values on .iso and light values on .iso[data-theme=light];
// lift the light block so it follows the viewer's theme instead.
const LIGHT = kit.ISO_CSS.match(/\.iso\[data-theme="light"\]\{([^}]*)\}/)[1];

const css = `
:root{
  /* layout: one column, a lab bench card, controls and the formula under it */
  --bg:#0b0b0b;--card:#131313;--ink:#e6e6e6;--text:#a3a3a3;--muted:#6e6e6e;--rule:#2a2a2a;--control:#1b1b1b;
  --accent:#f0a35e;--z-solid:#7aa2ff;--z-visco:#f2c14e;--z-liquid:#ff8a4c;
  --glass:#9ec3d6;--glass-back:.07;--glass-front:.13;
  --cat-paper:#3a2414;--cat-top:#a8642f;--cat-s0:#4a2c16;--cat-s1:#5a351a;--cat-s2:#6c401f;--cat-s3:#7f4b24;--cat-edge:#f2b27a;--cat-face:#2a160a;--cat-pink:#f39a9a;
  --display:"Noto Serif SC","Songti SC",serif;--body:"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;--mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
  color-scheme:dark;
}
@media (prefers-color-scheme: light){
  :root:not([data-theme="dark"]){
    --bg:#f2f2ef;--card:#fbfbfa;--ink:#18181a;--text:#57575a;--muted:#8c8c90;--rule:#d9d9d5;--control:#ffffff;
    --accent:#c4621f;--z-solid:#3e63dd;--z-visco:#b7860b;--z-liquid:#e2571b;
    --glass:#5f8fa8;--glass-back:.06;--glass-front:.1;
    --cat-paper:#fbe3c8;--cat-top:#ffdcb3;--cat-s0:#e09a5c;--cat-s1:#eaad72;--cat-s2:#f2bf8a;--cat-s3:#f8cfa2;--cat-edge:#7a3f16;--cat-face:#3a1f0c;--cat-pink:#e0707a;
    color-scheme:light;
  }
  :root:not([data-theme="dark"]) .iso{${LIGHT}}
}
:root[data-theme="light"]{
  --bg:#f2f2ef;--card:#fbfbfa;--ink:#18181a;--text:#57575a;--muted:#8c8c90;--rule:#d9d9d5;--control:#ffffff;
  --accent:#c4621f;--z-solid:#3e63dd;--z-visco:#b7860b;--z-liquid:#e2571b;
  --glass:#5f8fa8;--glass-back:.06;--glass-front:.1;
  --cat-paper:#fbe3c8;--cat-top:#ffdcb3;--cat-s0:#e09a5c;--cat-s1:#eaad72;--cat-s2:#f2bf8a;--cat-s3:#f8cfa2;--cat-edge:#7a3f16;--cat-face:#3a1f0c;--cat-pink:#e0707a;
  color-scheme:light;
}
:root[data-theme="light"] .iso{${LIGHT}}
html,body{background:var(--bg)}
body{color:var(--text);font:15px/1.7 var(--body);-webkit-font-smoothing:antialiased}
${kit.ISO_CSS}
.iso{background:var(--bg)}
.page{max-width:780px;margin:0 auto;padding-inline:16px;padding-block:40px 72px}
.eyebrow{font:500 11.5px/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 14px}
.eyebrow b{color:var(--accent);font-weight:500}
h1{font:700 clamp(34px,6vw,52px)/1.1 var(--display);color:var(--ink);margin:0 0 14px;text-wrap:balance;letter-spacing:.01em}
.lead{max-width:62ch;margin:0 0 8px;color:var(--text)}
.lead em{font-style:normal;color:var(--ink)}
.iso-figure{margin:28px 0 0}
.iso-plate{padding:46px 18px 44px}
.iso-plate-corner[data-corner="readout"]{color:var(--ink)}
.glass-back{fill:var(--glass);opacity:var(--glass-back);stroke:none}
.glass-front{fill:var(--glass);opacity:var(--glass-front);stroke:none}
.glint{opacity:.55}
.cat{--anatomy-paper:var(--cat-paper);--anatomy-top:var(--cat-top);--anatomy-shade-0:var(--cat-s0);--anatomy-shade-1:var(--cat-s1);--anatomy-shade-2:var(--cat-s2);--anatomy-shade-3:var(--cat-s3)}
.cat .iso-edge{stroke:var(--cat-edge)}
.cat .slice>.iso-edge{stroke-opacity:.32}
.cat .slice.stripe>.iso-edge{stroke-opacity:.85}
.cat .face .iso-line{stroke:var(--cat-edge);opacity:.7}
.tail path{fill:none;stroke-linecap:round;stroke-linejoin:round;vector-effect:none!important}
.tail-edge{stroke:var(--cat-edge)}
.tail-body{stroke:var(--cat-s3)}
.eye{fill:var(--cat-face)}
.eye-glint{fill:#fff}
.eye-closed,.mouth{fill:none;stroke:var(--cat-face);stroke-linecap:round;vector-effect:none!important}
.nose{fill:var(--cat-pink)}
.zone{fill:none;stroke-width:2.4px;stroke-linecap:butt}
.zone[data-zone="solid"]{stroke:var(--z-solid)}
.zone[data-zone="visco"]{stroke:var(--z-visco)}
.zone[data-zone="liquid"]{stroke:var(--z-liquid)}
.hand{stroke-width:1.2px}
.pointer{fill:var(--accent);stroke:var(--accent)}
.lamp-glow{opacity:0;transition:opacity .4s;filter:blur(4px)}
.lamp[data-on] .lamp-glow{opacity:.55}
.lamp[data-on][data-zone="solid"] .lamp-glow,.lamp[data-on][data-zone="solid"] .iso-top{fill:var(--z-solid)}
.lamp[data-on][data-zone="visco"] .lamp-glow,.lamp[data-on][data-zone="visco"] .iso-top{fill:var(--z-visco)}
.lamp[data-on][data-zone="liquid"] .lamp-glow,.lamp[data-on][data-zone="liquid"] .iso-top{fill:var(--z-liquid)}
.lamp[data-on] .iso-shade{fill-opacity:.8}

.panel{display:grid;gap:18px;margin-top:18px;padding:18px;background:var(--card);box-shadow:0 0 0 1px var(--rule)}
.row{display:grid;gap:8px;min-width:0}
.label{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font:500 11px/1.3 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.label output{font:500 15px/1 var(--mono);letter-spacing:0;text-transform:none;color:var(--ink);font-variant-numeric:tabular-nums}
input[type=range]{width:100%;accent-color:var(--accent);margin:4px 0 0}
.scale{display:flex;justify-content:space-between;font:11px/1 var(--mono);color:var(--muted)}
.choices{display:flex;flex-wrap:wrap;gap:8px}
.choice{flex:1 1 0;min-width:0;display:grid;gap:2px;padding:9px 12px;border:1px solid var(--rule);background:var(--control);color:var(--text);font:500 14px/1.3 var(--body);text-align:left;cursor:pointer;border-radius:2px}
.choice small{font:11px/1.3 var(--mono);color:var(--muted)}
.choice[aria-pressed="true"]{border-color:var(--accent);color:var(--ink);box-shadow:inset 0 0 0 1px var(--accent)}
.choice:focus-visible,#tour:focus-visible,input[type=range]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.split{display:grid;grid-template-columns:2fr 1.2fr;gap:18px}
.result{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 20px;padding:14px 16px;background:var(--bg);box-shadow:0 0 0 1px var(--rule)}
.formula{font:15px/1.5 var(--mono);color:var(--text);font-variant-numeric:tabular-nums;min-width:0}
.formula b{color:var(--ink);font-weight:500}
.formula .de{color:var(--accent)}
.pill{display:inline-flex;align-items:center;gap:8px;padding:5px 12px 5px 10px;border-radius:99px;font:600 14px/1 var(--body);color:var(--ink);box-shadow:0 0 0 1px var(--rule)}
.pill i{width:9px;height:9px;border-radius:50%;background:var(--z-solid)}
.pill[data-zone="visco"] i{background:var(--z-visco)}
.pill[data-zone="liquid"] i{background:var(--z-liquid)}
.meter{display:grid;gap:6px;flex:1 1 180px;max-width:260px}
.meter .label{font-size:10.5px}
.bar{height:6px;background:var(--rule);position:relative;border-radius:3px;overflow:hidden}
.bar::after{content:"";position:absolute;inset:0 auto 0 0;width:var(--phi,0%);background:var(--accent);border-radius:3px;transition:width .2s}
#tour{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border:1px solid var(--rule);background:var(--control);color:var(--ink);font:500 13px/1 var(--body);cursor:pointer;border-radius:2px;justify-self:start}
#tour::before{content:"";width:0;height:0;border-left:7px solid var(--accent);border-top:5px solid transparent;border-bottom:5px solid transparent}
#tour[aria-pressed="true"]::before{width:7px;height:10px;border:0;background:linear-gradient(90deg,var(--accent) 0 2.5px,transparent 2.5px 4.5px,var(--accent) 4.5px)}
.notes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:36px}
.note{padding-top:12px;border-top:2px solid var(--z-solid)}
.note[data-zone="visco"]{border-color:var(--z-visco)}
.note[data-zone="liquid"]{border-color:var(--z-liquid)}
.note h3{margin:0 0 4px;font:600 15px/1.4 var(--body);color:var(--ink)}
.note h3 span{font:12px var(--mono);color:var(--muted);margin-left:6px}
.note p{margin:0;font-size:13.5px;line-height:1.6}
.about{margin-top:36px;max-width:64ch;font-size:14px}
.about h2{font:700 20px/1.3 var(--display);color:var(--ink);margin:0 0 8px}
.about p{margin:0 0 10px}
.fine{font-size:12.5px;color:var(--muted)}
@media (max-width:620px){.split{grid-template-columns:1fr}.notes{grid-template-columns:1fr}.iso-plate{padding:42px 6px 64px}}
@media (prefers-reduced-motion:reduce){.bar::after,.lamp-glow{transition:none}}
`;

const choices = (items, attr) => items.map(([value, title, sub]) => `<button type="button" class="choice" id="${attr}-${value}" data-${attr}="${value}" aria-pressed="false">${title}<small>${sub}</small></button>`).join("");

const plate = kit.plateHtml({
  fig: "Fig 1",
  title: "Feline rheometer",
  hint: "拖动观察时间，看猫流动",
  readout: "T 0.50 s · De 10.0 · 固体",
  keys: [
    { mark: "lit", label: "秒表指针与 De 指针：随观察时间转动" },
    { mark: "raised", label: "滑台：把选中的容器送到测试工位" },
    { mark: "edge", label: "玻璃容器：猫最终会贴合它的形状" },
  ],
  caption: "猫从“猫形”变成“容器形”的程度按 1 − e^(−T/τ) 计算。τ 是示意值，论文里没有测量过真实的猫。",
  body: `<div class="iso-stage" data-figure></div>`,
});

const body = `<title>猫是液体吗？</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;500;600&family=Noto+Serif+SC:wght@700&display=swap">
<style>${css}</style>
<div class="iso">
<main class="page">
  <p class="eyebrow"><b>2017 搞笑诺贝尔物理学奖</b> · Fardin, “On the Rheology of Cats” (2014)</p>
  <h1>猫是液体吗？</h1>
  <p class="lead">流变学用<em>底波拉数 De = τ / T</em> 判断一种材料是固体还是液体：τ 是材料“流满”容器所需的弛豫时间，T 是你观察的时间。De 远大于 1 时它像固体，远小于 1 时它像液体。所以猫是固体还是液体，取决于你看了多久。</p>
  ${plate}
  <section class="panel" aria-label="实验控制">
    <div class="row">
      <label class="label" for="obs-time">观察时间 T <output data-t>0.50 s</output></label>
      <input id="obs-time" type="range" min="0" max="1000" step="1" value="200">
      <div class="scale" aria-hidden="true"><span>0.1 s</span><span>1 s</span><span>10 s</span><span>1 分钟</span><span>10 分钟</span></div>
    </div>
    <div class="split">
      <div class="row"><span class="label">容器</span><div class="choices" role="group" aria-label="容器">${choices([["0", "方箱", "τ ≈ 5 s"], ["1", "洗手盆", "τ ≈ 30 s"], ["2", "细颈花瓶", "τ ≈ 2 分钟"]], "container")}</div></div>
      <div class="row"><span class="label">猫的状态</span><div class="choices" role="group" aria-label="猫的状态">${choices([["relaxed", "放松", "τ × 1"], ["alert", "警觉", "τ × 10"]], "mood")}</div></div>
    </div>
    <div class="result" aria-live="polite">
      <div class="formula" data-formula>De = τ / T</div>
      <span class="pill" data-state data-zone="solid"><i></i><span data-state-text>固体</span></span>
      <div class="meter"><span class="label">贴合容器的程度 <output data-phi-text>0%</output></span><div class="bar" data-phi></div></div>
    </div>
    <button type="button" id="tour" aria-pressed="true"><span>暂停演示</span></button>
  </section>
  <section class="notes" aria-label="三种状态">
    <div class="note" data-zone="solid"><h3>固体<span>De &gt; 3</span></h3><p>观察时间比弛豫时间短得多。猫来不及变形，保持自己的形状，坐在容器口上。</p></div>
    <div class="note" data-zone="visco"><h3>粘弹<span>0.3 – 3</span></h3><p>两个时间差不多。猫一边保持形状，一边慢慢往容器里沉，像蜂蜜或面团。</p></div>
    <div class="note" data-zone="liquid"><h3>液体<span>De &lt; 0.3</span></h3><p>观察时间远长于弛豫时间。猫填满容器，表面鼓成一个圆顶，只剩头和尾巴露在外面。</p></div>
  </section>
  <section class="about">
    <h2>这项研究</h2>
    <p>2014 年，法国物理学家 Marc-Antoine Fardin 在《Rheology Bulletin》上发表了 “On the Rheology of Cats”。他用流变学的标准工具分析了网上大量“猫装进容器”的照片，认真讨论了猫算不算液体，并凭这篇论文获得 2017 年搞笑诺贝尔物理学奖。</p>
    <p>他的结论是：判断一种材料是固体还是液体，要比较它的弛豫时间和观察时间。论文还顺带讨论了几个有趣的观察：容器越小、猫越放松，看起来就越像液体；年轻和年长的猫，弛豫时间可能不一样。</p>
    <p class="fine">本页所有 τ 都是为了演示设定的示意值。猫“流入”容器的程度用最简单的弛豫模型 1 − e^(−T/τ) 描述，警觉的猫按 τ × 10 处理。</p>
  </section>
</main>
</div>
<script type="module">${script.replace(/<\/(script)/gi, "<\\/$1")}</script>
`;

writeFileSync(join(HERE, "cat-rheology.html"), body);
if (process.argv.includes("--preview")) {
  const theme = process.argv.includes("--light") ? "light" : "dark";
  writeFileSync(join(HERE, `preview-${theme}.html`), `<!doctype html><html lang="zh" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body style="margin:0">${body}</body></html>`);
}
console.log("wrote cat-rheology.html");
