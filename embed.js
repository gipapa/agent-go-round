import{b as S,H as T,i as V,a as z,E as L}from"./assets/embed-bridge-Ds0CkJGL.js";const P="agent-go-round-embed",G="agent-go-round",W=`
  :host { all: initial; }
  .widget-root {
    --agr-width: 420px;
    --agr-height: 740px;
    color: #f1eef8;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-size: 13px;
  }
  button { font: inherit; }
  .launcher {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 2147483000;
    border: 1px solid #8768af;
    border-radius: 999px;
    color: #f5f0ff;
    background: #392d51;
    box-shadow: 0 12px 30px rgba(0, 0, 0, .3);
    padding: 11px 16px;
    cursor: pointer;
  }
  .launcher:hover, .launcher:focus-visible { border-color: #c4a7f3; background: #493961; outline: none; }
  .overlay {
    position: fixed;
    z-index: 2147483001;
    inset: 0;
    display: none;
    align-items: flex-end;
    justify-content: flex-end;
    background: rgba(8, 8, 12, .58);
    padding: 16px;
  }
  .overlay[data-open="true"] { display: flex; }
  .panel {
    position: relative;
    width: min(var(--agr-width), calc(100vw - 32px));
    height: min(var(--agr-height), calc(100vh - 32px));
    overflow: hidden;
    border: 1px solid #57506c;
    border-radius: 4px;
    background: #111116;
    box-shadow: 0 24px 70px rgba(0, 0, 0, .45);
  }
  iframe { display: block; width: 100%; height: 100%; border: 0; background: #111116; }
  .close {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 1;
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, .12);
    border-radius: 3px;
    color: #e8e7ee;
    background: rgba(17, 17, 22, .82);
    cursor: pointer;
  }
  .close:hover, .close:focus-visible { border-color: #c4a7f3; outline: none; }
  .widget-root[data-mode="inline"] .launcher { display: none; }
  .widget-root[data-mode="inline"] .overlay { position: relative; inset: auto; display: flex; align-items: stretch; justify-content: stretch; padding: 0; background: transparent; }
  .widget-root[data-mode="inline"] .panel { width: 100%; height: 100%; border: 0; border-radius: 0; box-shadow: none; }
  .widget-root[data-mode="inline"] .close { display: none; }
  @media (max-width: 600px) {
    .launcher { right: 14px; bottom: 14px; }
    .overlay { align-items: stretch; justify-content: stretch; padding: 0; }
    .panel { width: 100%; height: 100%; border: 0; border-radius: 0; }
  }
`;function B(t,i){return typeof t=="number"&&Number.isFinite(t)?`${Math.max(280,t)}px`:typeof t=="string"&&/^(\d+(\.\d+)?)(px|vh|vw|rem|%)$/.test(t.trim())?t.trim():i}function F(t){if(!t)return document.body;if(typeof t!="string")return t;const i=document.querySelector(t);if(!i)throw new Error(`AgentGoRound mount target not found: ${t}`);return i}function H(t){return t instanceof Error?t:new Error(String(t))}function K(t){var d,h;const i=(h=(d=globalThis.crypto)==null?void 0:d.randomUUID)==null?void 0:h.call(d);return i?`${t}-${i}`:`${t}-${Date.now()}-${Math.random().toString(36).slice(2)}`}const p=typeof document>"u"?void 0:document,r=p?p.currentScript instanceof HTMLScriptElement?p.currentScript:p.querySelector('script[src*="/embed.js"], script[src$="embed.js"]'):null,Y=r!=null&&r.src?new URL("./",r.src).href:p?new URL("/",p.baseURI).href:"/";function R(t={}){if(!p)throw new Error("AgentGoRound embed mount requires a browser document");const i=F(t.target),d=t.mode==="inline"?"inline":"popup",h=t.title||"AgentGoRound",D=t.buttonLabel||"Open AgentGoRound",k=new URL(t.appUrl||Y,document.baseURI).href,I=new URL(k).origin,E=K("widget"),b=document.createElement("div"),O=b.attachShadow({mode:"open"}),M=document.createElement("style");M.textContent=W;const u=document.createElement("div");u.className="widget-root",u.dataset.mode=d,u.style.setProperty("--agr-width",B(t.width,"420px")),u.style.setProperty("--agr-height",B(t.height,"740px"));const s=document.createElement("button");s.className="launcher",s.type="button",s.textContent=D,s.setAttribute("aria-haspopup","dialog"),s.setAttribute("aria-expanded","false");const n=document.createElement("div");n.className="overlay",n.dataset.open=d==="inline"||t.initiallyOpen?"true":"false",n.setAttribute("aria-hidden",n.dataset.open==="true"?"false":"true");const g=document.createElement("section");g.className="panel",g.setAttribute("role","dialog"),g.setAttribute("aria-modal","true"),g.setAttribute("aria-label",h);const m=document.createElement("button");m.className="close",m.type="button",m.textContent="×",m.setAttribute("aria-label","Close AgentGoRound");const l=document.createElement("iframe");l.title=h,l.src=k,l.setAttribute("loading","eager"),l.setAttribute("allow","clipboard-read; clipboard-write"),g.append(m,l),n.append(g),u.append(s,n),O.append(M,u),i.append(b);const v=new Map,f=new T(E);let y=!1;const c=(o,e=void 0)=>{for(const a of v.get(o)??[])a(e);b.dispatchEvent(new CustomEvent(`agent-go-round:${o}`,{detail:e}))},w=o=>{var e;(e=l.contentWindow)==null||e.postMessage({...o,source:P},I)},A=()=>{w({type:"host_tools",payload:{version:L,instanceId:E,tools:f.list()}})},q=o=>{if(!(y||o.source!==l.contentWindow||o.origin!==I)&&!(!o.data||o.data.source!==G)){if(o.data.type==="ready"){const e=o.data.payload;if(!e||typeof e!="object"||!("bridgeVersion"in e)||!V(e.bridgeVersion)||!("version"in e)||!z(e.version)){c("error",new Error("AgentGoRound embed protocol version mismatch"));return}c("ready",e)}if(o.data.type==="host_tool_call"){const e=o.data.payload;if(!e||typeof e!="object")return;f.execute(e).then(a=>{w({type:"host_tool_result",payload:a}),c("message",{source:G,type:"host_tool_result",payload:a})});return}if(o.data.type==="host_tool_approval_request"){const e=o.data.payload;if(!e||typeof e!="object")return;f.approve(e).then(a=>{w({type:"host_tool_approval_result",payload:{version:L,instanceId:E,requestId:e.requestId,...a}})});return}if(o.data.type==="host_tool_cancel"){const e=o.data.payload;e&&typeof e=="object"&&"requestId"in e&&typeof e.requestId=="string"&&f.cancel(e.requestId);return}if(o.data.type==="host_tool_approval_cancel"){const e=o.data.payload;e&&typeof e=="object"&&"requestId"in e&&typeof e.requestId=="string"&&f.cancelApproval(e.requestId);return}c("message",o.data)}},_=()=>{y||(n.dataset.open="true",n.setAttribute("aria-hidden","false"),s.setAttribute("aria-expanded","true"),c("open"),requestAnimationFrame(()=>l.focus()))},x=()=>{y||(n.dataset.open="false",n.setAttribute("aria-hidden","true"),s.setAttribute("aria-expanded","false"),c("close"),d==="popup"&&s.focus())},C=()=>{n.dataset.open==="true"?x():_()},U=o=>{o.key==="Escape"&&n.dataset.open==="true"&&x()},$=()=>{w({type:"hello",payload:{version:L,embedVersion:S,instanceId:E}}),A()};s.addEventListener("click",_),m.addEventListener("click",x),n.addEventListener("click",o=>{o.target===n&&x()}),l.addEventListener("load",$),window.addEventListener("keydown",U),window.addEventListener("message",q),n.dataset.open==="true"&&s.setAttribute("aria-expanded","true");const N={element:b,iframe:l,open:_,close:x,toggle:C,postMessage:(o,e)=>w({type:o,payload:e}),registerTool:(o,e,a)=>{const j=f.registerWithApproval({...o,label:o.label||o.name},e,a);return A(),()=>{j(),A()}},on:(o,e)=>{const a=v.get(o)??new Set;return a.add(e),v.set(o,a),()=>a.delete(e)},destroy:()=>{y||(y=!0,window.removeEventListener("keydown",U),window.removeEventListener("message",q),l.removeEventListener("load",$),b.remove(),v.clear())}};return d==="inline"&&c("open"),N}if(typeof window<"u"){const t=window.AgentGoRound??{version:S,mount:R};if(t.version=S,t.mount=R,window.AgentGoRound=t,r&&(r.dataset.target!==void 0||r.dataset.autoMount==="true"))try{t.defaultWidget=R({target:r.dataset.target||void 0,appUrl:r.dataset.appUrl||void 0,mode:r.dataset.mode==="inline"?"inline":"popup",title:r.dataset.title||void 0,buttonLabel:r.dataset.buttonLabel||void 0,width:r.dataset.width||void 0,height:r.dataset.height||void 0,initiallyOpen:r.dataset.initiallyOpen==="true"})}catch(i){const d=H(i);console.error(`[AgentGoRound] ${d.message}`)}}
