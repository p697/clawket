const studies = {
  a: { name:'光场', en:'Lumen', summary:'把熟悉的小猫，变成一件被光照亮的银色雕塑。少量冷光、深色留白，让 Pro 有安静而明确的分量。', material:'石墨黑 · 银色光泽 · 慢速轨道', purpose:'品牌入口、首次了解 Pro', judgment:'品牌感首选。画面更有记忆点，需验证深色付费墙与浅色 App 的过渡。', general:['你的 Agent，更多可能。','把你的 AI 世界，随身带走。'] },
  b: { name:'纸间', en:'Atelier', summary:'像收到一封来自伙伴的邀请。纸张、陶土和柔和的橄榄绿，让技术产品也有温度；标题与横排套餐采用编辑式排版。', material:'暖纸白 · 陶土色 · 橄榄绿', purpose:'日常陪伴、长期使用的品牌气质', judgment:'亲近感首选。视觉更柔和，适合把猫的个性延伸到整个产品。', general:['好伙伴，<br>不必只带一个。','你的 Agent 团队，<br>和每一段值得继续的对话。'] },
  c: { name:'折光', en:'Prism', summary:'把光收进一枚通透的徽章。冰蓝、珍珠白与细腻边缘光，形成轻盈的高级感；支付区域保持清晰、稳定。', material:'冰蓝 · 珍珠白 · 层叠透明材质', purpose:'从现有浅色设计自然升级', judgment:'融合度首选。艺术感收在顶部，按钮和文字不依赖玻璃效果。', general:['你的 AI 世界，<br>更近一步。','连接更多伙伴，看见完整对话。<br>一切，都在手边。'] },
  d: { name:'全景', en:'Perspective', summary:'用真实的产品价值说服用户。几张有内容、有层次的会话卡片，让“完整记录”从一句功能描述变成看得见的收获。', material:'纯白 · 松针绿 · 会话卡片', purpose:'解锁会话、添加连接等情境入口', judgment:'情境转化的优先测试方向。用户刚点开的内容就是主角。', general:['每个伙伴，<br>每一段对话。','从主聊天到各个渠道，<br>完整掌握 Agent 的每一步。'] },
};
const contexts={
  general:null,
  history:{title:'每一段对话，<br>都看完整。',sub:'渠道、任务与子 Agent 的记录，<br>从第一句，到最新回复。',benefits:[['chat','查看完整会话记录'],['search','回看消息，找到关键上下文'],['team','连接和管理更多 Agent']],cta:'解锁完整会话'},
  connections:{title:'把更多伙伴，<br>带在身边。',sub:'OpenClaw、Hermes、YouMind 精灵，<br>一个 App，随时切换。',benefits:[['link','不限连接数，自由切换'],['team','管理多个 Agent'],['chat','查看完整会话记录']],cta:'解锁更多连接'},
  agents:{title:'为每个想法，<br>找一个伙伴。',sub:'在 OpenClaw 创建更多 Agent，<br>让每个伙伴，各有所长。',benefits:[['team','在 OpenClaw 新建 Agent'],['link','不限连接数，管理更多伙伴'],['chat','查看完整会话记录']],cta:'解锁创建 Agent'},
};
const generalBenefits=[['team','更多 Agent，不限连接数'],['chat','完整会话，不止最新两条'],['control','随时管理你的 OpenClaw']];
const lumenBenefits=[['infinity','更多 Agent，不限连接数'],['chat','随时查看渠道与任务会话'],['brain','编辑 Agent 的人格与记忆'],['control','配置、备份与诊断你的 Agent']];
const params=new URLSearchParams(location.search);
let language=Object.hasOwn(paywallLocales,params.get('lang'))?params.get('lang'):'zh-Hans';
const tr=(key,price)=>paywallLocales[language][key]?.replace('{{price}}',price)??key;
let layout=params.get('layout')==='current'?'current':'refined';
let currentDesign=Object.hasOwn(studies,params.get('design'))?params.get('design'):'a';
let context=Object.hasOwn(contexts,params.get('context'))?params.get('context'):'general';
const standalone=Object.hasOwn(studies,params.get('standalone'))?params.get('standalone'):null;
let comparing=params.get('compare')==='1';
const state=Object.fromEntries(Object.keys(studies).map(k=>[k,{plan:'annual',monthly:false}]));
if(standalone){currentDesign=standalone;document.body.classList.add('standalone')}
function originalPhone(design){const s=studies[design],copy=contexts[context],plan=state[design].plan;return `<div class="phone-wrap" data-wrap="${design}"><article class="phone ${design}" data-layout="${layout}" aria-label="${s.name}付费墙"><div class="status-bar"><span>9:41</span><i class="island"></i><span class="status-icons">${icon('signal')}${icon('wifi')}<i class="battery"></i></span></div><div class="paywall"><div class="topbar"><button class="close" data-action="close" aria-label="关闭付费墙">${icon('x')}</button><div class="brand">${catLogo()}<span>clawket</span><span class="pro">PRO</span></div><button class="restore" data-action="restore">恢复购买</button></div><div class="content-scroll"><div class="hero">${heroArt(design,context)}</div><div class="heading"><h2>${copy?.title||s.general[0]}</h2><p class="sub">${copy?.sub||s.general[1]}</p></div><ul class="benefits">${(design==='a' ? (context==='general'?lumenBenefits:context==='history'?[lumenBenefits[1],lumenBenefits[0],lumenBenefits[2],lumenBenefits[3]]:lumenBenefits) : (copy?.benefits||generalBenefits)).map(([i,t])=>`<li>${icon(i)}<span>${t}</span></li>`).join('')}</ul></div><div class="offer"><div class="plans" role="radiogroup" aria-label="订阅套餐">${planButton(design,'annual')}${planButton(design,'lifetime')}${state[design].monthly?planButton(design,'monthly'):''}</div><button class="monthly" data-action="monthly">${state[design].monthly?'收起月付方案':'查看月付方案'}</button><button class="purchase" data-action="purchase"><span>${copy?.cta||'开启 Clawket Pro'}</span>${icon('arrow')}</button><p class="billing">${billing(plan,design)}</p><div class="legal"><button data-action="terms">使用条款</button><span aria-hidden="true" style="font-size:8px;color:var(--muted)">·</span><button data-action="privacy">隐私政策</button></div></div></div><div class="home-bar"></div><div class="closed-state">${catLogo()}<h3>先继续探索</h3><p>你随时可以回来了解 Pro。<br>这是原型的关闭状态。</p><button data-action="reopen">重新查看方案</button></div></article><div class="variant-caption"><span>${design.toUpperCase()} / ${s.en}</span><span>${s.name} · 393 × 852</span></div></div>`}
function oldBilling(plan){return plan==='annual'?'US$19.99 / 年，自动续订，可随时取消':plan==='lifetime'?'US$34.99 一次购买，无需续订':'US$2.99 / 月，自动续订，可随时取消'}
function oldPlanButton(design,type){const selected=state[design].plan===type;const annual=type==='annual',life=type==='lifetime';return `<button class="plan${type==='monthly'?' monthly-plan visible':''}" data-plan="${type}" role="radio" aria-checked="${selected}" aria-label="${annual?'年付，US$19.99，每年自动续订':life?'终身，US$34.99，一次购买':'月付，US$2.99，每月自动续订'}"><span class="plan-name">${annual?'年付':life?'终身':'月付'}${annual?'<span class="plan-badge">推荐</span>':''}</span><span class="price"><small>US$</small>${annual?'19.99':life?'34.99':'2.99'}<small>${annual?' / 年':life?'':' / 月'}</small></span><span class="plan-detail">${annual?'约 US$1.67 / 月':life?'一次购买，长期陪伴':'按月订阅'}</span><span class="radio" aria-hidden="true"></span></button>`}
function render(){document.getElementById('language').value=language;const s=studies[currentDesign];document.getElementById('layout-study').hidden=currentDesign!=='a'||comparing;document.querySelectorAll('[data-layout-choice]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.layoutChoice===layout));document.body.classList.toggle('compare',comparing&&!standalone);document.getElementById('study-title').innerHTML=comparing?'四种气质，<br>同一份价值。':`${s.name}<br><em>${s.en}.</em>`;document.getElementById('study-summary').textContent=comparing?'所有版本采用同一组价格和权益。先比较气质，再点击顶部方案进入单独预览。':s.summary;document.getElementById('study-meta').innerHTML=`<div><span>视觉语言</span>${s.material}</div><div><span>适合场景</span>${s.purpose}</div><div><span>我的判断</span>${s.judgment}</div>`;document.getElementById('context').value=context;document.querySelectorAll('[data-design]').forEach(b=>b.setAttribute('aria-current',!comparing&&b.dataset.design===currentDesign));document.getElementById('compare').textContent=comparing?'单独预览 ↗':'并排比较 ↗';document.getElementById('gallery').innerHTML=(comparing&&!standalone?Object.keys(studies):[currentDesign]).map(phone).join('');updateAddress();}
function updateAddress(){const p=new URLSearchParams;p.set('lang',language);if(standalone)p.set('standalone',standalone);else p.set('design',currentDesign);if(context!=='general')p.set('context',context);if(layout==='current')p.set('layout',layout);if(comparing)p.set('compare','1');history.replaceState(null,'','?'+p)}
let toastTimer;function toast(text){const el=document.getElementById('toast');el.textContent=text;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3500)}
document.querySelectorAll('[data-design]').forEach(b=>b.addEventListener('click',()=>{currentDesign=b.dataset.design;comparing=false;render()}));
document.getElementById('compare').addEventListener('click',()=>{comparing=!comparing;render()});
document.getElementById('context').addEventListener('change',e=>{context=e.target.value;render()});
document.getElementById('gallery').addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;const wrap=button.closest('[data-wrap]'),d=wrap.dataset.wrap;
  if(button.dataset.plan){state[d].plan=button.dataset.plan;wrap.querySelectorAll('[data-plan]').forEach(b=>b.setAttribute('aria-checked',b.dataset.plan===state[d].plan));wrap.querySelector('.billing').textContent=billing(state[d].plan);return}
  switch(button.dataset.action){
    case 'monthly':{const before=wrap.querySelector('.content-scroll').scrollTop;state[d].monthly=!state[d].monthly;if(!state[d].monthly&&state[d].plan==='monthly')state[d].plan='annual';wrap.outerHTML=phone(d);document.querySelector(`[data-wrap="${d}"] .content-scroll`).scrollTop=before;break}
    case 'purchase':toast(`购买预览 · ${billing(state[d].plan)}。正式版将打开 App Store 确认。`);break;
    case 'restore':toast('原型演示：正式版将恢复此 Apple 账户的已有购买。');break;
    case 'terms':toast('原型演示：正式版打开 Clawket 使用条款。');break;
    case 'privacy':toast('原型演示：正式版打开 Clawket 隐私政策。');break;
    case 'close':wrap.querySelector('.phone').classList.add('closed');break;
    case 'reopen':wrap.querySelector('.phone').classList.remove('closed');break;
  }
});
document.getElementById('gallery').addEventListener('keydown',e=>{const b=e.target.closest('[data-plan]');if(!b||!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(e.key))return;e.preventDefault();const buttons=[...b.closest('.plans').querySelectorAll('[data-plan]')],delta=['ArrowRight','ArrowDown'].includes(e.key)?1:-1,next=buttons[(buttons.indexOf(b)+delta+buttons.length)%buttons.length];next.click();next.focus()});
document.querySelectorAll('[data-layout-choice]').forEach(b=>b.addEventListener('click',()=>{layout=b.dataset.layoutChoice;render()}));
document.getElementById('language').addEventListener('change',e=>{language=e.target.value;render()});
render();

// Pause decorative loops while the prototype tab is hidden.
document.addEventListener("visibilitychange",()=>document.documentElement.toggleAttribute("data-paused",document.hidden));

function phone(design) {
  const markup=originalPhone(design);
  if(design!=='a') return markup;
  const tpl=document.createElement('template');tpl.innerHTML=markup;
  const q=s=>tpl.content.querySelector(s);
  q('.phone').lang=language;
  q('.restore').textContent=tr('Restore');
  q('.heading h2').textContent=tr(({history:'Explore your Agent conversations',connections:'Every Agent in your pocket',agents:'Bring every Agent into the roster'})[context]||'More possibilities with your Agents');
  q('.heading .sub').textContent=tr(({connections:'OpenClaw and Hermes together, ready whenever you are.',agents:'Agents beyond main are a Pro feature.'})[context]||'Take your AI world with you.');
  const keys=['More Agents, unlimited connections','Conversations across channels and tasks',"Shape your Agent's personality and memory",'Configure, back up and diagnose your Agents'];
  if(context==='history') [keys[0],keys[1]]=[keys[1],keys[0]];
  if(context==='connections') keys[0]='Unlimited connections';
  if(context==='agents') keys[0]='Unlimited Agents';
  [...tpl.content.querySelectorAll('.benefits li span')].forEach((el,i)=>el.textContent=tr(keys[i]));
  q('.monthly').textContent=tr('View monthly plan');
  q('.monthly').hidden=state[design].monthly;
  q('.phone').dataset.planLayout=state[design].monthly?'rows':'cards';
  q('.purchase span').textContent=tr('Start Clawket Pro');
  q('[data-action=terms]').textContent=tr('Terms');q('[data-action=privacy]').textContent=tr('Privacy');
  return tpl.innerHTML;
}
function billing(plan,design=currentDesign) {
  if(design!=='a') return oldBilling(plan);
  const price=plan==='annual'?'US$19.99':plan==='monthly'?'US$2.99':'US$34.99';
  if(plan==='lifetime') return tr('{{price}} · One-time purchase',price);
  return tr(plan==='annual'?'{{price}} / year · Renews automatically':'{{price}} / month · Renews automatically',price)+' · '+tr('Cancel anytime');
}
function planButton(design,type) {
  if(design!=='a')return oldPlanButton(design,type);
  const selected=state[design].plan===type,annual=type==='annual',life=type==='lifetime';
  const title=tr(annual?'Annual':life?'Lifetime':'Monthly');
  const price=annual?'US$19.99':life?'US$34.99':'US$2.99';
  const detail=annual?tr('{{price}} / month','$1.66'):tr(life?'One-time purchase':'Billed monthly');
  return `<button class="plan${type==='monthly'?' monthly-plan visible':''}" data-plan="${type}" role="radio" aria-checked="${selected}" aria-label="${title}, ${price}, ${detail}"><span class="plan-name"><span>${title}</span>${annual?`<span class="plan-badge">${tr('Recommended')}</span>`:''}</span><span class="price">${price}</span><span class="plan-detail">${detail}</span></button>`;
}
