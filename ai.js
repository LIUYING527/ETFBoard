/* ══════════════════════════════════════════════════════════════════
   ai.js — ETFBoard AI 模块（独立文件，prompt 迭代只改这里）
   职责：量化数据快照 → system prompt → DeepSeek 多轮对话
   依赖 index.html 全局：ETFS, D, POS, MKT, fP, fPct, fBig, mav,
                         calcRSI, esc, toast, isTrade, openCfg
   ══════════════════════════════════════════════════════════════════ */
const ETFAI=(()=>{
const LSKEY='etfAIChat';
let msgs=[],busy=false,ctrl=null,inited=false;
const $=id=>document.getElementById(id);

// ── markdown 轻量渲染 ─────────────────────────────────────────────
function mdH(raw){
  const lines=raw.split('\n');let h='',ul=false,ol=false;
  for(const ln of lines){
    const cl=()=>{if(ul){h+='</ul>';ul=false;}if(ol){h+='</ol>';ol=false;}};
    if(/^#{1,3}\s/.test(ln)){cl();h+=`<h3>${inl(ln.replace(/^#+\s/,''))}</h3>`;continue;}
    if(/^[-*]\s/.test(ln)){if(!ul){h+='<ul>';ul=true;}h+=`<li>${inl(ln.slice(2))}</li>`;continue;}
    if(/^\d+\.\s/.test(ln)){if(!ol){h+='<ol>';ol=true;}h+=`<li>${inl(ln.replace(/^\d+\.\s/,''))}</li>`;continue;}
    cl();if(!ln.trim()){h+='<br>';continue;}h+=`<p>${inl(ln)}</p>`;
  }
  if(ul)h+='</ul>';if(ol)h+='</ol>';return h;
}
function inl(s){return esc(s).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>');}

// ── 数据快照 ──────────────────────────────────────────────────────
const fpct=(v,n=1)=>(v==null||isNaN(v))?'—':(v>=0?'+':'')+v.toFixed(n)+'%';
const fYi=v=>v==null?'—':(v/1e8).toFixed(1)+'亿';

function rowOf(e){
  const d=D[e.code]||{};
  if(!d.closes?.length)return`${e.code} ${e.name.slice(0,5)} 数据缺失`;
  const macd=d.macd?(d.macd.dif>d.macd.dea?'多':'空'):'—';
  const flow=d.flow?`主力${fYi(d.flow.main)}(${fpct(d.flow.mainPct)})`:'主力—';
  const out=(d.outVol!=null&&d.inVol)?`外${Math.round(d.outVol/(d.outVol+d.inVol)*100)}%`:'';
  const vr=d.volRatio?`量${d.volRatio.toFixed(1)}x`:'';
  const sh=d.sharesChg5!=null?`份5${fpct(d.sharesChg5)}`:'';
  const pm=d.prem!=null?`溢${fpct(d.prem,2)}`:'';
  const vw=d.min?.dev!=null?`VW${fpct(d.min.dev)}`:'';
  const adx=d.adx?`ADX${d.adx.adx.toFixed(0)}`:'';
  const div=d.obv?.div?d.obv.div:'';
  return`${e.code} ${e.name.slice(0,5)} 价${fP(d.price)} ${fpct(d.chg)} 动20 ${fpct(d.mom20)} RSI${d.rsi?.toFixed(0)??'—'} ${adx} MACD${macd} BB${d.bb?Math.round(d.bb.pctB*100)+'%':'—'} ${flow} ${out} ${vr} ${sh} ${pm} ${vw} ${div} 分${d.score??'—'}`.replace(/\s+/g,' ');
}

function marketBlock(){
  const n=new Date(),p2=v=>String(v).padStart(2,'0');
  const ds=`${n.getFullYear()}-${p2(n.getMonth()+1)}-${p2(n.getDate())} ${p2(n.getHours())}:${p2(n.getMinutes())}`;
  const g=t=>MKT.q[t];
  const idx=[['sh000001','上证'],['sz399001','深成'],['sz399006','创业板'],['sh000688','科创50'],['sh000852','中证1000'],['sh000012','国债']]
    .map(([t,nm])=>{const q=g(t);return q?.price?`${nm}${q.price.toFixed(q.price<1000?2:0)}(${fpct(q.chg)})`:`${nm}—`;}).join(' ');
  let t300='';
  if(MKT.k300?.closes?.length){
    const c=MKT.k300.closes,px=g('sh000300')?.price??c[c.length-1];
    const ma20=mav(c,20);
    const rsi=calcRSI(c,14);
    const w=c.slice(-250),hi=Math.max(...w);
    t300=` | 沪深300技术位: RSI${rsi?.toFixed(0)??'—'} ${ma20?(px>ma20?'MA20上':'MA20下'):''} 距250日高${((px-hi)/hi*100).toFixed(1)}%`;
  }
  let amt='';
  if(MKT.amtToday)amt=` | 两市成交${fYi(MKT.amtToday)}${MKT.amt5?'(5日均'+fYi(MKT.amt5)+')':''}${MKT.volRatio?' 量能比'+MKT.volRatio.toFixed(2):''}`;
  const senti=MKT.senti!=null?` | 情绪指数${MKT.senti}/100(${sentiLabel(MKT.senti)}) 宽度:MA20上${MKT.breadth??'—'}% MACD多头${MKT.macdBull??'—'}%`:'';
  return`[市场快照 ${ds}${isTrade()?' 交易中':''}] ${idx}${t300}${amt}${senti}`;
}
function sentiLabel(s){return s<20?'极度恐慌':s<40?'恐慌':s<60?'中性':s<80?'贪婪':'极度贪婪';}

function posBlock(){
  if(!POS.length)return'[持仓] 用户暂无持仓记录';
  const rows=POS.map(p=>{
    const e=ETFS.find(x=>x.code===p.code);if(!e)return'';
    const d=D[p.code]||{};
    const px=d.price??p.cost,pct=(px-p.cost)/p.cost*100,mv=px*p.shares;
    const atr=d.atr?` ATR${d.atr.toFixed(3)}(止损参考${(px-1.5*d.atr).toFixed(3)}/${(px-2.5*d.atr).toFixed(3)})`:'';
    const flow=d.flow?` 主力${fYi(d.flow.main)}(${fpct(d.flow.mainPct)})`:'';
    const sh=d.sharesChg5!=null?` 份5${fpct(d.sharesChg5)}`:'';
    const vw=d.min?.dev!=null?` VWAP偏${fpct(d.min.dev)}`:'';
    return`${e.name}(${p.code}) 成本${p.cost}×${p.shares}份 现价${fP(px)} 浮盈${pct.toFixed(1)}% 市值${Math.round(mv)}元 | RSI${d.rsi?.toFixed(0)??'—'} MACD${d.macd?(d.macd.dif>d.macd.dea?'多':'空'):'—'} BB${d.bb?Math.round(d.bb.pctB*100)+'%':'—'} MA20${d.ma20?fP(d.ma20):'—'} 得分${d.score??'—'}${atr}${flow}${sh}${vw}`;
  }).filter(Boolean).join('\n');
  let mv=0,cost=0;
  POS.forEach(p=>{const px=D[p.code]?.price||p.cost;mv+=px*p.shares;cost+=p.cost*p.shares;});
  return`[我的持仓]\n${rows}\n组合: 总市值${Math.round(mv)}元 总盈亏${mv-cost>=0?'+':''}${Math.round(mv-cost)}元 (${fpct(cost>0?(mv-cost)/cost*100:0)})`;
}

function snapshot(){
  const rows=ETFS.map(rowOf).join('\n');
  return`${marketBlock()}\n\n[ETF数据 36只](动20=20日动量 ADX>25趋势强 主力=主力净流入(东财) 外=外盘率 份5=份额5日变化(申赎) 溢=折溢价 VW=现价对VWAP偏离 分=综合得分/100)\n${rows}\n\n${posBlock()}`;
}

// ── system prompt ─────────────────────────────────────────────────
function sysPrompt(){
  return`你是A股ETF专业量化分析师，正与用户多轮对话。用户是A股ETF个人投资者（重仓科技类），核心诉求是结合持仓的「割/拿/补」操作建议。

【实时数据快照（每次发送自动更新）】
${snapshot()}

【回答原则】
- 数据说话：引用快照具体数字，不编造快照没有的数据；数据缺失就明说
- 简洁精准，中文，重要结论**加粗**，能用表格/列表就不用长段落
- 给操作建议必须带具体价位（用MA、ATR、布林轨、前高前低推算）
- A股为量化资金主导的市场：解读时优先考虑主力资金净流入、ETF份额申赎、折溢价、VWAP偏离这些机构行为信号，而非单看K线形态
- 用户追问时承接上下文，不要重复完整分析
- 末尾不加免责声明，除非用户要求`;
}

// ── 渲染 ──────────────────────────────────────────────────────────
function render(){
  const box=$('aichat');if(!box)return;
  if(!msgs.length){
    box.innerHTML='<div class="aiph">🤖 已装载全市场量化数据快照<br>点上方快捷按钮开始分析，或直接提问<br><span style="font-size:10px">例：「通信ETF主力在流入，我能补吗？」</span></div>';
  }else{
    box.innerHTML=msgs.map(m=>m.role==='user'
      ?`<div class="mrow-u"><div class="mub">${esc(m.content)}</div></div>`
      :`<div class="mrow-a"><div class="mab">${m.content?mdH(m.content):'<span style="color:var(--t3)">🤔 思考中…</span>'}</div></div>`
    ).join('');
  }
  const n=new Date(),p2=v=>String(v).padStart(2,'0');
  const si=$('aisnap');
  if(si)si.textContent=`数据 ${p2(n.getHours())}:${p2(n.getMinutes())}${MKT.senti!=null?` · 情绪${MKT.senti}`:''} · ${ETFS.filter(e=>D[e.code]?.closes?.length).length}/${ETFS.length}只就绪${POS.length?` · 持仓${POS.length}只`:''}`;
  box.scrollTop=box.scrollHeight;
}
function setBtn(){
  const b=$('aisend');if(!b)return;
  b.textContent=busy?'⏹ 停止':'发送';
  b.classList.toggle('stop',busy);
}

// ── 持久化 ────────────────────────────────────────────────────────
function persist(){try{localStorage.setItem(LSKEY,JSON.stringify(msgs.slice(-40)));}catch{}}
function restore(){try{const v=JSON.parse(localStorage.getItem(LSKEY)||'[]');msgs=Array.isArray(v)?v:[];}catch{msgs=[];}}

// ── DeepSeek 流式对话 ─────────────────────────────────────────────
async function send(text){
  text=(text||'').trim();if(!text)return;
  const key=localStorage.getItem('dsKey');
  if(!key){toast('请先在 ⚙️ 设置 API Key');openCfg();return;}
  if(busy){if(ctrl)ctrl.abort();return;}
  msgs.push({role:'user',content:text});
  msgs.push({role:'assistant',content:''});
  persist();render();busy=true;setBtn();
  ctrl=new AbortController();let full='';
  try{
    const resp=await fetch('https://api.deepseek.com/v1/chat/completions',{
      method:'POST',signal:ctrl.signal,
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
      body:JSON.stringify({model:'deepseek-chat',stream:true,max_tokens:1800,temperature:0.5,
        messages:[{role:'system',content:sysPrompt()},...msgs.slice(0,-1).slice(-18)]})
    });
    if(!resp.ok)throw new Error(`HTTP ${resp.status}`);
    const rdr=resp.body.getReader(),dec=new TextDecoder();
    while(true){
      const{done,value}=await rdr.read();if(done)break;
      for(const ln of dec.decode(value,{stream:true}).split('\n')){
        if(!ln.startsWith('data:'))continue;
        const dd=ln.slice(5).trim();if(dd==='[DONE]')break;
        try{const tok=JSON.parse(dd)?.choices?.[0]?.delta?.content;
          if(tok){full+=tok;msgs[msgs.length-1].content=full;render();}}catch{}
      }
    }
  }catch(e){
    if(e.name==='AbortError'){msgs[msgs.length-1].content=full||'*已停止*';}
    else{msgs[msgs.length-1].content=full+`\n\n⚠️ 错误: ${e.message}`;}
  }finally{
    busy=false;ctrl=null;setBtn();persist();render();
  }
}

// ── 快捷分析预设 ──────────────────────────────────────────────────
const QUICK={
scan:`请做全市场扫描，按以下结构输出：
### 1. 市场环境（指数状态/两市量能/情绪指数解读，2-3句）
### 2. 主力资金动向（今日主力净流入Top3与流出Top3，解读机构意图）
### 3. 趋势共振品种（MACD多+RSI45-65+MA20上+ADX>20）
### 4. 值得布局 Top3（每只1句买入逻辑+参考买入价）
### 5. 风险警示（超买/量价背离/份额持续赎回/溢价过热的品种）
### 6. 轮动方向（科技vs宽基vs红利vs债，1-2周维度）`,
pos:`请诊断我的持仓组合：
1. 逐只给出明确的**割/拿/补**结论（加粗），理由结合浮盈幅度+主力资金+份额变化+技术面
2. 每只标注：ATR止损位、关键支撑/阻力位
3. 要补的给出补仓参考价和批次建议
4. 最后2句：整体仓位管理与组合风险点评`,
risk:`排查当前风险信号，按严重程度排序：
- 我的持仓个股风险（止损位距离/主力出逃/量价背离）
- 全市场风险（情绪指数极端化/两市缩量/指数破位/板块级超买）
每条给出具体的观察指标数值和应对动作`,
rotate:`分析资金轮动方向：
1. 科技/宽基/红利/债券/商品 当前相对强弱排序（用动量、相对强度、主力净流入、份额变化交叉验证）
2. 资金正在从哪类流向哪类？
3. 未来1-2周值得超配哪1-2类？给出具体品种和介入参考价`,
};
function quick(type,arg){
  if(type==='one'){
    const e=ETFS.find(x=>x.code===arg);if(!e)return;
    const pos=POS.find(p=>p.code===arg);
    const d=D[arg]||{};
    const px=d.price??pos?.cost;
    const pct=pos&&px!=null?((px-pos.cost)/pos.cost*100).toFixed(1):null;
    send(pos
      ?`我持有${e.name}(${arg})，成本${pos.cost}元×${pos.shares}份，现价${fP(px)}，浮盈${pct}%。请给我**割/拿/补**的明确结论：①结论一句话 ②理由（主力资金/份额/技术面/我的盈亏幅度）③关键价位（补仓价/止损位/目标位，用ATR和MA推算）④如果再跌5%和10%分别怎么办`
      :`分析一下${e.name}(${arg})：趋势状态、主力资金与份额动向、关键支撑阻力位，现在适合买入吗？给出具体介入价位和止损位`);
    return;
  }
  if(QUICK[type])send(QUICK[type]);
}

function sendInput(){const t=$('aitext');if(!t)return;const v=t.value;t.value='';send(v);}
function clear(){if(busy&&ctrl)ctrl.abort();msgs=[];persist();render();toast('对话已清空');}
function init(){if(inited)return;inited=true;restore();render();setBtn();
  const t=$('aitext');
  if(t)t.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendInput();}});
}
return{init,send,sendInput,quick,clear};
})();
