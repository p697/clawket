const CAT = {"width": 94, "height": 88, "parts": [{"d": "M12.9532 7.92 H14.476000000000003 A20.304 34.496 0 0 1 34.78 42.416000000000004 V45.8656 A3.0456 5.1743999999999994 0 0 1 31.7344 51.04 H14.475999999999999 A5.076 8.624 0 0 1 9.4 42.416 V13.9568 A3.5532 6.0367999999999995 0 0 1 12.9532 7.92 Z", "transform": "rotate(-13 22.09 29.48)", "role": "earLeft", "pivot": {"x": 26.4, "y": 48.5}}, {"d": "M79.524 13.2 H81.04679999999999 A3.5532 5.2976 0 0 1 84.6 18.4976 V43.47200000000001 A5.076 7.5680000000000005 0 0 1 79.524 51.040000000000006 H62.2656 A3.0456 4.540800000000001 0 0 1 59.22 46.4992 V43.472 A20.304 30.272000000000002 0 0 1 79.524 13.2 Z", "transform": "rotate(13 71.91 32.12)", "role": "earRight", "pivot": {"x": 68.2, "y": 48.6}}, {"d": "M41.3412 22 H52.6588 A34.7612 26.8664 0 0 1 87.42 48.8664 V59.48799999999999 A32.336000000000006 24.991999999999997 0 0 1 55.083999999999996 84.47999999999999 H38.916000000000004 A32.336000000000006 24.991999999999997 0 0 1 6.58 59.48799999999999 V48.8664 A34.7612 26.8664 0 0 1 41.3412 22 Z", "role": "face"}], "eyes": [{"x": 24.44, "y": 39.6, "width": 11.7312, "height": 20.24, "rx": 5.8656}, {"x": 57.8288, "y": 39.6, "width": 11.7312, "height": 20.24, "rx": 5.8656}]};
function catShape(fill='currentColor', eyes='#fff', extra='') {
  return `<g ${extra}>${CAT.parts.map(p=>`<path d="${p.d}" ${p.transform?`transform="${p.transform}"`:''} fill="${fill}"/>`).join('')}<g class="blink">${CAT.eyes.map(e=>`<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="${e.rx}" fill="${eyes}"/>`).join('')}</g></g>`;
}
function lumenCat(){return `<g class="lumen-head"><defs><mask id="a-silhouette" x="0" y="0" width="94" height="88" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse">${CAT.parts.map(p=>`<g class="${p.role==='earLeft'?'lumen-ear-left':p.role==='earRight'?'lumen-ear-right':''}"><path d="${p.d}" ${p.transform?`transform="${p.transform}"`:''} fill="white"/></g>`).join('')}</mask></defs><rect width="94" height="88" fill="url(#a-metal)" mask="url(#a-silhouette)"/><g class="lumen-eye-look"><g class="lumen-eye-blink">${CAT.eyes.map(e=>`<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="${e.rx}" fill="url(#a-eye)"/>`).join('')}</g></g></g>`}
function catLogo(){return `<svg class="logo" aria-hidden="true" viewBox="0 0 94 88">${catShape('currentColor','var(--canvas)')}</svg>`}
function icon(name){const paths={
  infinity:'<path d="M12 12c-2-3-3-5-6-5a5 5 0 0 0 0 10c3 0 4-2 6-5s3-5 6-5a5 5 0 0 1 0 10c-3 0-4-2-6-5z"/>',
  brain:'<path d="M12 18V5a3 3 0 0 0-5.8-1 4 4 0 0 0-3.5 5.5 4 4 0 0 0 .5 7 4 4 0 0 0 7.8 2.1M12 5a3 3 0 0 1 5.8-1 4 4 0 0 1 3.5 5.5 4 4 0 0 1-.5 7 4 4 0 0 1-7.8 2.1M8 9a3 3 0 0 1-3-3m14 0a3 3 0 0 1-3 3M7 14a3 3 0 0 0 1 5m9-5a3 3 0 0 1-1 5"/>',

  x:'<path d="m6 6 12 12M18 6 6 18"/>',arrow:'<path d="M4 12h15m-5-5 5 5-5 5"/>',check:'<path d="m5 12 4 4L19 6"/>',
  team:'<path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-3.9"/><circle cx="9.5" cy="7" r="4"/><path d="M16 3.2a4 4 0 0 1 0 7.6"/>',
  chat:'<path d="M20 14a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3zM7 8h9m-9 4h6"/>',
  link:'<path d="m10 13 4-4m-7 5-2 2a4 4 0 0 0 6 6l4-4a4 4 0 0 0 0-6M9 10a4 4 0 0 1 0-6l4-4a4 4 0 0 1 6 6l-2 2" transform="translate(1 1) scale(.9)"/>',
  control:'<path d="M4 7h5m5 0h6M4 17h11m4 0h1"/><circle cx="11" cy="7" r="2"/><circle cx="17" cy="17" r="2"/>',
  hash:'<path d="m9 3-2 18m10-18-2 18M3 9h18M2 15h18"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  wifi:'<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0"/><circle cx="12" cy="20" r="1"/>',
  signal:'<path d="M4 20v-5m5 5V11m5 9V7m5 13V3" stroke-width="3"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'
};return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]||paths.chat}</svg>`}
function svgRoot(content){return `<svg class="hero-art" aria-hidden="true" viewBox="0 0 393 230" fill="none">${content}</svg>`}
function artA(context){return svgRoot(`
  <defs>
    <radialGradient id="a-halo"><stop stop-color="#b2c5d3" stop-opacity=".38"/><stop offset=".5" stop-color="#7b8d9c" stop-opacity=".1"/><stop offset="1" stop-color="#151618" stop-opacity="0"/></radialGradient>
    <linearGradient id="a-metal" x1=".2" y1="0" x2=".8" y2="1"><stop stop-color="#faffff"/><stop offset=".2" stop-color="#cbd2d7"/><stop offset=".44" stop-color="#6b777e"/><stop offset=".53" stop-color="#222a2e"/><stop offset=".66" stop-color="#9aa5af"/><stop offset=".79" stop-color="#e2e7eb"/><stop offset="1" stop-color="#515b64"/></linearGradient>
    <linearGradient id="a-edge"><stop stop-color="#202328"/><stop offset=".37" stop-color="#535c63"/><stop offset=".51" stop-color="#e4eaee"/><stop offset=".63" stop-color="#68747c"/><stop offset="1" stop-color="#1b1d21"/></linearGradient>
    <linearGradient id="a-eye" x2="0" y2="1"><stop stop-color="#080b0d"/><stop offset="1" stop-color="#303a41"/></linearGradient>
    <filter id="a-blur"><feGaussianBlur stdDeviation="5"/></filter>
    <filter id="a-shadow" x="-50%" y="-50%" width="200%" height="210%"><feDropShadow dx="0" dy="13" stdDeviation="12" flood-color="#000" flood-opacity=".8"/></filter>
  </defs>
  <ellipse class="light-breathe" cx="197" cy="99" rx="174" ry="126" fill="url(#a-halo)"/>
  <g class="orbit-sweep"><ellipse cx="196" cy="119" rx="165" ry="57" transform="rotate(-24 196 119)" stroke="url(#a-edge)" stroke-width="1.1"/><ellipse cx="196" cy="119" rx="156" ry="53" transform="rotate(-24 196 119)" stroke="#94a1aa" stroke-opacity=".14" stroke-width=".5"/></g>
  <ellipse cx="197" cy="188" rx="62" ry="7" fill="#020304" opacity=".6" filter="url(#a-blur)"/>
  <g class="float"><g filter="url(#a-shadow)"><g transform="translate(115 23) scale(1.73)">${lumenCat()}</g></g></g>
  <circle cx="335" cy="68" r="2" fill="#b9c6d0"/><path d="M64 165h6m-3-3v6" stroke="#919da7" stroke-width=".6"/>
  `)}
function artB(context){return svgRoot(`
  <defs>
    <linearGradient id="b-paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#efe8d8"/><stop offset="1" stop-color="#e9deca"/></linearGradient>
    <linearGradient id="b-clay" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#c67553"/><stop offset=".55" stop-color="#b85f41"/><stop offset="1" stop-color="#914a32"/></linearGradient>
    <filter id="b-grain"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".07"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter>
    <filter id="b-shadow" x="-50%" y="-50%" width="220%" height="220%"><feDropShadow dx="2" dy="9" stdDeviation="6" flood-color="#776544" flood-opacity=".2"/></filter>
    <pattern id="b-grid" width="18" height="18" patternUnits="userSpaceOnUse"><path d="M18 0H0v18" stroke="#b9a685" stroke-opacity=".15" stroke-width=".5"/></pattern>
  </defs>
  <rect x="0" y="0" width="393" height="230" rx="3" fill="url(#b-paper)"/>
  <rect width="393" height="230" fill="url(#b-grid)"/>
  <circle cx="279" cy="83" r="60" fill="#e4ce9c" opacity=".6"/>
  <g transform="translate(70 31) rotate(-9 95 70)"><rect width="179" height="156" fill="#f7f2e5" filter="url(#b-shadow)"/><rect x="9" y="9" width="161" height="137" fill="none" stroke="#c9baa0" stroke-width=".6"/>
    <g transform="translate(30 15) scale(1.23)">${catShape('url(#b-clay)','#f8edda')}</g>
    <path d="m130 133 21-8" stroke="#b0a084" stroke-width=".7"/>
  </g>
  <g transform="translate(256 128) rotate(14)" filter="url(#b-shadow)"><rect width="64" height="50" rx="2" fill="#78836a"/><path d="M10 14h33M10 23h41M10 32h24" stroke="#e9ecd9" stroke-width="1.2" opacity=".7"/></g>
  <path d="M282 27c13 5 20 16 19 27m-1-11 1 11 10-4" stroke="#8d846e" stroke-width="1" stroke-linecap="round"/>
  <rect width="393" height="230" fill="transparent" filter="url(#b-grain)" opacity=".45"/>
  `)+`<div class="hero-annotation">${context==='history'?'Every conversation has a story.':'Good company. Wherever you go.'}</div>`}
function artC(context){return svgRoot(`
  <defs>
    <radialGradient id="c-halo"><stop stop-color="#b4b9f1" stop-opacity=".7"/><stop offset=".7" stop-color="#c5dbf9" stop-opacity=".4"/><stop offset="1" stop-color="#f4f8fe" stop-opacity="0"/></radialGradient>
    <linearGradient id="c-glass" x1=".1" y1="0" x2=".8" y2="1"><stop stop-color="#fff" stop-opacity=".9"/><stop offset=".34" stop-color="#e2e5fb" stop-opacity=".4"/><stop offset=".65" stop-color="#95a2d5" stop-opacity=".55"/><stop offset="1" stop-color="#f5fcff" stop-opacity=".95"/></linearGradient>
    <linearGradient id="c-rim" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset=".4" stop-color="#b4c6e3"/><stop offset=".55" stop-color="#fff"/><stop offset=".8" stop-color="#859bc6"/><stop offset="1" stop-color="#ecfcff"/></linearGradient>
    <linearGradient id="c-cat" x1="0" y1="0" x2=".85" y2="1"><stop stop-color="#536eaa"/><stop offset=".4" stop-color="#7e85b9"/><stop offset=".73" stop-color="#c5d7ed"/><stop offset="1" stop-color="#7289b2"/></linearGradient>
    <filter id="c-shadow" x="-50%" y="-50%" width="200%" height="220%"><feDropShadow dx="0" dy="9" stdDeviation="9" flood-color="#6d81b8" flood-opacity=".25"/></filter>
  </defs>
  <ellipse cx="203" cy="119" rx="197" ry="121" fill="url(#c-halo)"/>
  <g opacity=".35" stroke="#9cafca" stroke-width=".5"><ellipse cx="198" cy="132" rx="171" ry="57" transform="rotate(-17 198 132)"/><ellipse cx="198" cy="132" rx="156" ry="52" transform="rotate(-17 198 132)"/></g>
  <g class="float" filter="url(#c-shadow)">
    <rect x="136" y="36" width="137" height="143" rx="38" fill="#d2dcf2" stroke="url(#c-rim)" stroke-width="1.2" transform="rotate(14 204 108)"/>
    <rect x="108" y="27" width="148" height="157" rx="42" fill="url(#c-glass)" stroke="url(#c-rim)" stroke-width="1.6" transform="rotate(-9 182 105)"/>
    <g transform="translate(126 47) scale(1.2)">${catShape('url(#c-cat)','#f6faff')}</g>
    <path d="M125 69c0-16 9-25 25-26l44-6" stroke="white" stroke-opacity=".85" stroke-width="2" stroke-linecap="round"/>
  </g>
  <g transform="translate(293 140)"><circle r="17" fill="#f3faff" fill-opacity=".6" stroke="url(#c-rim)"/><path d="m-6 0 4 4 8-9" stroke="#8196b7" stroke-width="1.5" stroke-linecap="round"/></g>
  <circle cx="75" cy="64" r="5" fill="#f7ffff" fill-opacity=".65" stroke="#bcd0e8" stroke-width=".5"/>
  `)+`<div class="hero-annotation">${context==='history'?'THE WHOLE PICTURE':'YOUR AGENTS. CLOSER.'}</div>`}
function artD(context){let first='Slack · #设计',second='每天的灵感整理',third='Telegram · 产品讨论',body='今天的讨论，我已经整理好了。',reply='关键结论和下一步都在这里。';
  if(context==='connections'){first='OpenClaw';second='Hermes';third='YouMind 精灵';body='三个世界，一个熟悉的入口。';reply='你的 Agent，都在身边。'}
  if(context==='agents'){first='研究助手';second='编程搭档';third='Lucy · 新的伙伴';body='给每个想法，找到合适的伙伴。';reply='在 OpenClaw 创建你的 Agent。'}
  return `<div class="thread-card back"><div class="thread-top"><span class="channel-icon">${icon('hash')}</span>${first}</div><div class="type-line"></div><div class="type-line short"></div></div><div class="thread-card middle"><div class="thread-top"><span class="channel-icon">${icon('clock')}</span>${second}</div><div class="type-line"></div><div class="type-line short"></div></div><div class="thread-card front float-card"><div class="thread-top"><span class="channel-icon">${icon('chat')}</span>${third}<small>刚刚</small></div><p>${body}</p><div class="reply-line"><span class="mini-cat">${catLogo()}</span><em>${reply}</em></div></div><div class="hero-annotation">${context==='connections'?'连接示意':context==='agents'?'Agent 示意':'会话示意 · 非真实消息'}</div>`}
function heroArt(design,context){return ({a:artA,b:artB,c:artC,d:artD})[design](context)}
