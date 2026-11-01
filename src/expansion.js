(function(){
"use strict";
const cd=3600000,icons=["⚽","🧤","👟","👕","🏆","🥅"];let timer=null,profileBase;
const B=(s,fn,c="secondary")=>{const b=document.createElement("button");b.type="button";b.className=c;b.textContent=s;b.onclick=fn;return b},T=(s)=>safeText("p",s,"muted"),P=(a,b)=>{const e=document.createElement("section");e.className="feature-panel";e.append(safeText("h2",a),T(b));return e},F=n=>(Math.round(n*100)/100).toLocaleString("ru-RU",{maximumFractionDigits:2})+"%",own=()=>getUserTeam()?.players||[];
function rel(t,p,n){state.relationships||={};let k=playerRelationKey(t,p),before=Number(state.relationships[k]||0),v=Math.max(0,Math.min(100,before+n/100));state.relationships[k]=v;if(v>before){state.relationshipHistory=Array.isArray(state.relationshipHistory)?state.relationshipHistory:[];state.relationshipHistory.push({team:t.id,playerId:p.careerId||p.id||p.name,player:p.name,after:v,at:Date.now()});if(typeof publishCoachEventOnce==="function"&&t.id!==getUserTeam()?.id&&before<50&&v>=50)publishCoachEventOnce("relation-milestone:"+t.id+":"+(p.careerId||p.id||p.name),"player","Налажены отношения с футболистом","Отношения с "+p.name+" из команды «"+t.name+"» достигли "+Math.floor(v)+"%. Теперь можно проверить возможность обмена.",{priority:"high",important:true})}if(typeof updateCoachRespect==="function")updateCoachRespect();return v}
function transfer(){openPage("transfers")}
function install(){
 state.relationships||={};state.trainingCooldowns||={};state.trainingHistory||=[];state.transferHistory||=[];state.externalRosters||={};state.coachGoals||={};
 const baseGetTeam=getUserTeam;
 getUserTeam=function(){const t=baseGetTeam();if(t&&Array.isArray(state.userRoster))t.players=state.userRoster;return t};

 const nav=document.querySelector(".menu-grid");if(nav){nav.querySelectorAll('[data-page="transfers"]').forEach(b=>b.remove());document.getElementById("transferHome")?.remove()}
 const old=pages.cabinet.render;if(!old.wrap){const w=function(){const n=old();n.prepend(B("🔁 Трансферный обмен игроками",transfer,"primary"));return n};w.wrap=true;pages.cabinet.render=w}
 profileBase=openPlayerProfile;openPlayerProfile=function(t,p,i){profileBase(t,p,i);if(t.id===getUserTeam()?.id)return;const box=P("Отношения с футболистом","Каждые 100 очков в «Три в ряд» дают +1 процентный пункт отношений.");box.append(B("ПОДНЯТЬ ОТНОШЕНИЯ С ИГРОКОМ",()=>match3(t,p),"primary"),B("Выбрать для наблюдения в следующем матче",()=>{state.matchRelationSelections||={};state.matchRelationSelections[t.id]=p.name;saveState();alert("Выбран игрок для наблюдения: "+p.name+". Начисление отношений после матча появится вместе с матчевым движком.")}),B("Предложить обмен",()=>{state.transferTarget={team:t.id,name:p.name};saveState();transfer()}));document.querySelector("#pageContent .player-profile")?.append(box)};
 pages.training.render=training;pages.goals.render=renderCoachGoals;
function localDayStart(now=Date.now()){const d=new Date(now);d.setHours(0,0,0,0);return d.getTime()}
 function goalWindow(id,now=Date.now()){state.coachGoals=state.coachGoals||{};const g=state.coachGoals[id]||{};return Math.max(localDayStart(now),Number(g.completedAt||0)+72000000)}
 function goalDefinitions(){return [
  {id:"train-all",title:"Проведи индивидуальную тренировку со всеми футболистами",description:"Проведи индивидуальную тренировку с каждым футболистом своей команды в текущем цикле.",reward:1000},
  {id:"win-three",title:"Выиграй 3 официальных матча",description:"Одержи три победы в официальных матчах в текущем цикле.",reward:5000},
  {id:"external-relation",title:"Наладь отношения с футболистом другой команды",description:"Доведи отношения хотя бы с одним футболистом другой команды до 50%.",reward:5000}
 ]}
 function getGoalProgress(goal,now=Date.now()){
  const start=goalWindow(goal.id,now),team=getUserTeam();
  if(goal.id==="train-all"){
   const roster=team?.players||[];if(!roster.length)return {current:0,total:0,done:false};
   const records=(state.trainingHistory||[]).filter(x=>x&&x.type==="individual"&&x.team===team.id&&Number(x.at)>=start);
   const trained=new Set(records.map(x=>x.playerId||x.player));
   const current=roster.filter(p=>trained.has(p.careerId||p.id||p.name)||trained.has(p.name)).length;
   return {current,total:roster.length,done:current>=roster.length};
  }
  if(goal.id==="win-three"){
   const records=(state.careerHistory?.officialMatches||[]).filter(x=>Number(x.at||x.completedAt||0)>=start&&x.result==="W");
   return {current:records.length,total:3,done:records.length>=3};
  }
  if(goal.id==="external-relation"){
   const ownId=team?.id;let best=0;
   (state.relationshipHistory||[]).filter(x=>Number(x.at)>=start&&x.team!==ownId).forEach(x=>{best=Math.max(best,Number(x.after)||0)});
   return {current:Math.min(50,Math.floor(best)),total:50,done:best>=50};
  }
  return {current:0,total:1,done:false}
 }
 function renderCoachGoals(){
  const w=document.createElement("div");if(!getUserTeam()){w.append(placeholder("Сначала создай команду."));return w}
  w.append(P("Цели тренера","Цели обновляются по реальному календарю. После выполнения награда автоматически начисляется в XP тренера, а повторное выполнение открывается через 20 часов."));
  const now=Date.now();
  goalDefinitions().forEach(goal=>{
   state.coachGoals=state.coachGoals||{};let record=state.coachGoals[goal.id]||{};state.coachGoals[goal.id]=record;
   const unlock=Number(record.completedAt||0)+72000000,locked=now<unlock,progress=getGoalProgress(goal,now);
   if(progress.done&&!locked&&Number(record.rewardedAt||0)<goalWindow(goal.id,now)){
    awardTrainerXp(goal.reward);record.completedAt=now;record.rewardedAt=now;record.lastReward=goal.reward;saveState();
    w.append(P("Цель выполнена!",goal.title+" — начислено "+goal.reward.toLocaleString("ru-RU")+" XP. Следующее выполнение доступно через 20 часов."));return;
   }
   const card=P(goal.title,goal.description),line=locked?"Повторно доступна через "+Math.ceil((unlock-now)/3600000)+" ч. "+Math.ceil(((unlock-now)%3600000)/60000)+" мин.":"Прогресс: "+progress.current+" / "+progress.total;
   card.append(T("Награда: "+goal.reward.toLocaleString("ru-RU")+" XP"),T(line));if(!locked&&progress.done)card.append(T("Цель выполнена. Награда будет начислена при обновлении целей."));w.append(card);
  });return w
 }
 function freeYardMonthKey(){const day=Math.max(1,Number(state.gameDay)||1),season=Math.max(1,Number(state.seasonNumber)||1);return season+":"+ (Math.floor((day-1)/28)+1)}
function randomFreeYardPlayer(){
 // In 2.8.1, introduce the 21 reserved original players one at a time through the existing Free Yard cadence.
 const reserve=Array.isArray(state.leagueReservePlayers)?state.leagueReservePlayers:[];
 if(state.careerRulesVersion==="2.8.1"&&reserve.length){
  const index=Math.floor(Math.random()*reserve.length),[player]=reserve.splice(index,1);
  if(player){
   state.leagueReservePlayers=reserve;
   return {...player,id:"free-reserve-"+String(player.careerId||player.name||Date.now()),skills:{...(player.skills||{})},age:Number(player.age)||14+Math.floor(Math.random()*7),potential:Number(player.potential)||35+Math.floor(Math.random()*56),portraitIndex:Number(player.portraitIndex)||1+Math.floor(Math.random()*77),freeYard:true,invited:false};
  }
 }
 const all=[];(leagueData?.teams||[]).forEach(team=>(team.players||[]).forEach(player=>{const parts=String(player.name||"").trim().split(/\s+/);if(parts.length>1)all.push({first:parts.slice(1).join(" "),last:parts[0]})}));
 const firsts=[...new Set(all.map(x=>x.first).filter(Boolean))],lasts=[...new Set(all.map(x=>x.last).filter(Boolean))];
 const first=firsts[Math.floor(Math.random()*firsts.length)]||"Алексей",last=lasts[Math.floor(Math.random()*lasts.length)]||"Смирнов";
 const position=["ВР","ЗЩ","ПЗ","НП"][Math.floor(Math.random()*4)],skills={ВР:15+Math.floor(Math.random()*56),ЗЩ:15+Math.floor(Math.random()*56),ПЗ:15+Math.floor(Math.random()*56),НП:15+Math.floor(Math.random()*56)};
 skills[position]=Math.min(75,skills[position]+8);
 return {id:"free-"+Date.now()+"-"+Math.random().toString(36).slice(2,8),name:last+" "+first,position,nationality:"Россия",age:14+Math.floor(Math.random()*7),skills,potential:35+Math.floor(Math.random()*56),portraitIndex:1+Math.floor(Math.random()*77),freeYard:true,invited:false};
}
function startFreeYardViewing(player,relationKey){
 const existing=document.getElementById("freeYardViewingOverlay");if(existing)existing.remove();
 let score=0,passed=0,lives=3,disposed=false,raf=0,last=performance.now(),moveAccumulator=0;
 let carX=50,objects=[],held=new Set();
 const root=document.createElement("div");root.id="freeYardViewingOverlay";
 root.style.cssText="position:fixed;inset:0;z-index:100000;background:rgba(3,10,18,.94);display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;color:#fff;font:15px system-ui,sans-serif";
 root.innerHTML='<section style="width:min(720px,100%);max-height:96dvh;overflow:auto;background:#132238;border:2px solid #69b8ff;border-radius:16px;padding:14px;box-sizing:border-box;box-shadow:0 12px 50px #0009"><h2 style="margin:0 0 5px;color:#a8d8ff">ПРОСМОТР: ДОБЕРИСЬ ДО ПОЛЯ</h2><p style="margin:0 0 10px;color:#d5e6f7">Управляй машиной, объезжай препятствия и доберись на просмотр. За каждое успешно пройденное препятствие — 4 очка. Столкновение отнимает жизнь.</p><div id="viewingStats" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px;font-weight:700">Очки: 0 · Проехано: 0 · Жизни: 3</div><div id="viewingRoad" role="application" aria-label="Дорога на просмотр" style="position:relative;width:100%;height:min(54vh,430px);min-height:270px;overflow:hidden;border:3px solid #9fb9d5;border-radius:12px;background:#3d4b5b;touch-action:manipulation"><div style="position:absolute;left:22%;top:0;width:56%;height:100%;border-left:5px solid #eee;border-right:5px solid #eee;box-sizing:border-box;background:repeating-linear-gradient(0deg,transparent 0 36px,#e8e8e8 36px 58px,transparent 58px 90px)"></div><div id="viewingCars" style="position:absolute;inset:0"></div><div id="viewingPlayerCar" style="position:absolute;left:50%;bottom:8%;width:34px;height:54px;background:#2477dd;border:3px solid #cce5ff;border-radius:8px;transform:translateX(-50%);box-shadow:0 2px 8px #111;z-index:2"></div></div><p style="margin:10px 0;text-align:center;color:#bed1e5;font-size:13px">Управляй влево и вправо, объезжай препятствия. Компьютер: A/D или ←/→. Телефон: касайся левой или правой стороны дороги.</p><button id="viewingFinish" type="button" style="width:100%;padding:13px;border:2px solid #f4d06f;border-radius:10px;background:#7a5b17;color:#fff;font-weight:800;cursor:pointer">СОХРАНИТЬ И ЗАКОНЧИТЬ</button></section>';
 document.body.appendChild(root);
 const field=root.querySelector("#viewingRoad"),cars=root.querySelector("#viewingCars"),playerCar=root.querySelector("#viewingPlayerCar"),stats=root.querySelector("#viewingStats");
 function paintCars(){cars.replaceChildren();objects.forEach(o=>{const car=document.createElement("div");car.style.cssText="position:absolute;left:"+o.x+"%;top:"+o.y+"%;width:34px;height:50px;background:#e9bd4b;border:3px solid #fff;border-radius:7px;transform:translateX(-50%);box-sizing:border-box";cars.appendChild(car)})}
 function updateStats(){stats.textContent="Очки: "+score+" · Проехано: "+passed+" · Жизни: "+lives}
 function moveCar(direction){if(disposed)return;carX=Math.max(27,Math.min(73,carX+direction*3.6));playerCar.style.left=carX+"%"}
 function onKeyDown(e){const key=String(e.key||"").toLowerCase();if(["arrowleft","arrowright","a","d"].includes(key)){e.preventDefault();if(key==="arrowleft"||key==="a")held.add("left");if(key==="arrowright"||key==="d")held.add("right")}}
 function onKeyUp(e){const key=String(e.key||"").toLowerCase();if(key==="arrowleft"||key==="a")held.delete("left");if(key==="arrowright"||key==="d")held.delete("right")}
 function clearKeys(){held.clear()}
 function onFieldPointer(e){if(disposed)return;const rect=field.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*100;moveCar(x<carX?-1:1);e.preventDefault()}
 function finish(){
  if(disposed)return;disposed=true;cancelAnimationFrame(raf);window.removeEventListener("keydown",onKeyDown,true);window.removeEventListener("keyup",onKeyUp,true);window.removeEventListener("blur",clearKeys);field.removeEventListener("pointerdown",onFieldPointer);
  const before=Math.max(0,Math.min(100,Number(state.relationships?.[relationKey]||0)));
  const after=Math.min(100,Math.round((before+score/100)*100)/100);
  state.relationships=state.relationships||{};state.relationships[relationKey]=after;
  if(after>before){state.relationshipHistory=Array.isArray(state.relationshipHistory)?state.relationshipHistory:[];state.relationshipHistory.push({team:"free-yard",playerId:player.id,player:player.name,before,after,earnedPoints:score,at:Date.now()})}
  saveState();
  const safeName=String(player.name||"Футболист").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  root.innerHTML='<section style="width:min(520px,100%);background:#132238;border:2px solid #69b8ff;border-radius:16px;padding:24px;box-sizing:border-box;text-align:center;color:#fff;font:15px system-ui,sans-serif"><h2 style="margin-top:0;color:#a8d8ff">'+(lives<=0?"ПРОСМОТР ЗАВЕРШЁН":"ЗАЕЗД СОХРАНЁН")+'</h2><p>Футболист: <b>'+safeName+'</b></p><p>Набрано очков: <b>'+score+'</b></p><p>Прибавка к отношениям: <b>+'+(Math.round((after-before)*100)/100).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2})+'%</b></p><p>Отношения: <b>'+before.toLocaleString("ru-RU",{maximumFractionDigits:2})+'% → '+after.toLocaleString("ru-RU",{maximumFractionDigits:2})+'%</b></p><p style="color:#bed1e5">Каждые 100 очков дают 1%. Характеристики откроются при достижении 60% отношений.</p><button id="viewingReturn" type="button" style="width:100%;padding:13px;border:0;border-radius:10px;background:#2b8c57;color:white;font-weight:800;cursor:pointer">ВЕРНУТЬСЯ В СВОБОДНЫЙ ДВОР</button></section>';
  root.querySelector("#viewingReturn").onclick=()=>{root.remove();openPage("freeyard")}
 }
 function tick(){
  if(disposed)return;const now=performance.now(),dt=Math.min(.06,(now-last)/1000);last=now;
  moveAccumulator+=dt;if(moveAccumulator>=.10){moveAccumulator=0;if(held.has("left"))moveCar(-1);else if(held.has("right"))moveCar(1)}
  if(Math.random()<dt*.9)objects.push({x:27+Math.random()*46,y:-8,hit:false});
  objects.forEach(o=>{o.y+=dt*35;if(!o.hit&&o.y>72&&o.y<87&&Math.abs(o.x-carX)<7){o.hit=true;lives--}});
  const kept=[];objects.forEach(o=>{if(o.hit)return;if(o.y>88){passed++;score+=4;return}if(o.y<105)kept.push(o)});objects=kept;
  paintCars();updateStats();if(lives<=0){finish();return}raf=requestAnimationFrame(tick)
 }
 window.addEventListener("keydown",onKeyDown,true);window.addEventListener("keyup",onKeyUp,true);window.addEventListener("blur",clearKeys);field.addEventListener("pointerdown",onFieldPointer);
 root.querySelector("#viewingFinish").onclick=finish;raf=requestAnimationFrame(tick)
}

function ensureFreeYardPlayer(){
 state.freeYardPlayers=Array.isArray(state.freeYardPlayers)?state.freeYardPlayers:[];
 state.freeYardMonthsSeen=Array.isArray(state.freeYardMonthsSeen)?state.freeYardMonthsSeen:[];
 const month=freeYardMonthKey();
 if(!state.freeYardMonthsSeen.includes(month)){
  const newcomer=randomFreeYardPlayer();
  state.freeYardPlayers.push({...newcomer,monthKey:month});
  state.freeYardMonthsSeen.push(month);
  saveState();
 }
}
function freeYardPage(){
 const w=document.createElement("div");
 if(!leagueData){w.append(placeholder("Загружаю список футболистов…"));return w}
 const team=getUserTeam();if(!team){w.append(placeholder("Сначала создай команду."));return w}
 ensureFreeYardPlayer();
 const available=(state.freeYardPlayers||[]).filter(p=>!p.invited);
 w.append(P("Новые игроки двора","Каждый игровой месяц появляется один новый футболист. Если его не пригласить, он останется доступен и в следующие месяцы."));
 if(team.players.length>=10)w.append(T("В команде уже 10 футболистов — освободите место, прежде чем приглашать новичка."));
 if(!available.length){w.append(placeholder("Пока нет свободных футболистов."));return w}
 available.forEach(player=>{
  const relationKey="free-yard::"+player.id,relation=Math.max(0,Math.min(100,Number(state.relationships[relationKey]||0)));
  const panel=document.createElement("section");panel.className="feature-panel free-yard-player";
  const row=document.createElement("div");row.className="feature-player-row";
  const img=document.createElement("img");img.className="free-yard-portrait";img.src="/images/portretplayers/portret"+((((Number(player.portraitIndex)||1)-1)%77)+1)+".jpg";img.alt=player.name;img.loading="lazy";
  const info=document.createElement("div");info.className="free-yard-player-info";info.append(safeText("h3",player.name),T(player.position+" · "+player.age+" лет · Отношения "+F(relation)));
  if(relation>=60){const stats=Object.entries(player.skills||{}).map(([k,v])=>k+": "+v).join(" · ");info.append(T("Характеристики: "+stats),T("Скрытый потенциал: "+player.potential))}
  else info.append(T("Характеристики и скрытый потенциал откроются при отношениях 60%."));
  row.append(img,info);panel.append(row);
  const actions=document.createElement("div");actions.className="feature-actions";
  actions.append(B("Вызвать на просмотр",()=>startFreeYardViewing(player,relationKey),"secondary"));
  const invite=B("Пригласить в команду",()=>{
   if(team.players.length>=10){alert("В команде не может быть больше 10 футболистов.");return}
   const newPlayer={...player,skills:{...(player.skills||{})},potential:player.potential,portraitIndex:player.portraitIndex};
   team.players.push(newPlayer);state.relationships[playerRelationKey(team,newPlayer)]=relation;state.userRoster=team.players;player.invited=true;state.freeYardPlayers=state.freeYardPlayers||[];saveState();openPage("freeyard");
  },"primary");invite.disabled=team.players.length>=10;
  actions.append(invite);panel.append(actions);w.append(panel);
 });
 return w
}
pages.freeyard={title:"Свободный двор",eyebrow:"НОВЫЕ ФУТБОЛИСТЫ",render:freeYardPage};
pages.transfers={title:"Трансферный обмен игроками",eyebrow:"ТРАНСФЕРЫ",render:transfersPage};
 saveState()
}
function match3(t,p){
 let board=[],sel=-1,score=0,lock=false,done=false,closed=false,timer=null;
 const ov=document.createElement("div");ov.className="feature-game-overlay";
 const m=document.createElement("section");m.className="feature-game-modal";
 const stat=safeText("p","Очки: 0","feature-game-stats"),grid=document.createElement("div");grid.className="relation-match3-board";
 const msg=safeText("p","Собирай три и более одинаковых футбольных предмета. Каждая клетка комбинации приносит 5 очков.","feature-game-message");
 const actions=document.createElement("div");actions.className="feature-actions";
 ov.append(m);m.append(safeText("h2","⚽ ФУТБОЛЬНЫЕ ТРИ В РЯД"),T(p.name+" · "+t.name),stat,grid,msg,actions);document.body.append(ov);
 const close=()=>{if(closed)return;closed=true;clearTimeout(timer);ov.remove()};
 const icons=["⚽","🧤","👟","👕","©️","🏆","🦵","🥅"];
 const rand=()=>Math.floor(Math.random()*icons.length);
 function draw(){grid.replaceChildren();board.forEach((v,i)=>{const b=B(v<0?"":icons[v]||"⚽",()=>pick(i),"relation-match3-cell"+(sel===i?" selected":""));b.setAttribute("aria-label",v<0?"Пустая клетка":"Футбольный предмет");b.disabled=lock||done||v<0;grid.append(b)});stat.textContent="Очки: "+score}
 function matches(){let f=new Set();for(let r=0;r<8;r++)for(let c=0;c<8;c++){let i=r*8+c,v=board[i];if(v<0)continue;if(c<6&&board[i+1]===v&&board[i+2]===v)for(let x=c;x<8&&board[r*8+x]===v;x++)f.add(r*8+x);if(r<6&&board[i+8]===v&&board[i+16]===v)for(let y=r;y<8&&board[y*8+c]===v;y++)f.add(y*8+c)}return f}
 function settle(){if(done||closed)return;let f=matches();if(!f.size){lock=false;draw();return}f.forEach(i=>board[i]=-1);score+=f.size*5;draw();timer=setTimeout(()=>{for(let c=0;c<8;c++){let s=[];for(let r=7;r>=0;r--)if(board[r*8+c]>=0)s.push(board[r*8+c]);while(s.length<8)s.push(rand());for(let r=7;r>=0;r--)board[r*8+c]=s[7-r]}draw();timer=setTimeout(settle,90)},120)}
 function saveAndExit(){if(done||closed)return;done=true;clearTimeout(timer);const before=Number(state.relationships[playerRelationKey(t,p)]||0),after=rel(t,p,score),delta=after-before;if(typeof updateCoachRespect==="function")updateCoachRespect();awardTrainerXp(score);state.trainingHistory=Array.isArray(state.trainingHistory)?state.trainingHistory:[];state.trainingHistory.push({type:"match3-relations",team:t.id,player:p.name,score,delta,at:Date.now()});saveState();msg.textContent="Результат сохранён. Очки: "+score+". Отношения с игроком: +"+F(delta)+". Общие отношения: "+F(after)+".";grid.replaceChildren();actions.replaceChildren(B("Вернуться в профиль",()=>{close();openPlayerProfile(t,p,0)},"primary"),B("Закрыть",close))}
 function pick(i){if(lock||done||closed)return;if(sel<0){sel=i;draw();return}if(Math.abs(Math.floor(sel/8)-Math.floor(i/8))+Math.abs(sel%8-i%8)!==1){sel=i;draw();return}let a=sel,b=i;sel=-1;[board[a],board[b]]=[board[b],board[a]];if(!matches().size){[board[a],board[b]]=[board[b],board[a]];draw();return}lock=true;draw();settle()}
 actions.append(B("СОХРАНИТЬ РЕЗУЛЬТАТ И ВЫЙТИ",saveAndExit,"primary"),B("Выйти без сохранения",close));
 board=Array.from({length:64},rand);for(let i=0;i<64;i++)while((i%8>1&&board[i]===board[i-1]&&board[i]===board[i-2])||(i>15&&board[i]===board[i-8]&&board[i]===board[i-16]))board[i]=rand();draw()
}
function training(){
 const w=document.createElement("div"),t=getUserTeam();
 if(!t){w.append(placeholder(leagueData?"Сначала создай команду.":"Загружаем состав команды…"));return w}
 const teamPanel=P("Командная тренировка","Каждый футболист получает ровно +1 к одной характеристике. Случайно выбранный игрок получает балл к основной характеристике; остальные — к случайной характеристике не своей основной позиции. Повтор — раз в 8 часов.");
 const cdKey="team-training",left=28800000-(Date.now()-Number(state.trainingCooldowns[cdKey]||0));
 const tb=B(left>0?"Доступно через "+Math.ceil(left/60000)+" мин.":"Провести командную тренировку",()=>runTeamTraining(t),left>0?"secondary":"primary");tb.disabled=left>0;
 teamPanel.append(tb,T("Правило распределения: один случайный игрок тренируется по своей основной позиции; у всех остальных случайно выбирается одна из трёх неподходящих основной позиции характеристик. Каждый игрок получает ровно +1, без повторов и без превышения 100."));
 const listPanel=P("Индивидуальная тренировка","ВР — поймай мяч (+5, конец после 10 пропущенных); ЗЩ — перехват мяча (+5, бесконечная игра, конец после 3 промахов или по кнопке сохранения); ПЗ/НП — змейка (+5 за мяч). Повтор раз в 1 час.");
 const list=document.createElement("div");list.className="feature-player-list";
 t.players.forEach(player=>{const row=document.createElement("div");row.className="feature-player-row";row.append(safeText("b",player.name+" · "+player.position));const id=t.id+"::"+player.name,left=cd-(Date.now()-Number(state.trainingCooldowns[id]||0));const b=B(left>0?"Доступно через "+Math.ceil(left/60000)+" мин.":"Начать тренировку",()=>playTraining(t,player,id),left>0?"secondary":"primary");b.disabled=left>0;row.append(b);list.append(row)});listPanel.append(list);
 w.append(teamPanel,listPanel,P("Расчёт наград индивидуальной тренировки","Каждые 100 итоговых очков = 1 п.п. отношений без округления. Каждые 200 положительных очков дают +1 к основной характеристике, остаток сгорает. Опыт тренера растёт на положительный итоговый счёт."));
 return w
}
function runTeamTraining(t){
 const key="team-training",cooldown=28800000,left=cooldown-(Date.now()-Number(state.trainingCooldowns[key]||0));
 if(left>0){alert("Командная тренировка будет доступна через "+Math.ceil(left/60000)+" мин.");return}
 const stats=["ВР","ЗЩ","ПЗ","НП"],mainIndex=Math.floor(Math.random()*t.players.length),results=[];
 if(!t.players.length){alert("В команде нет футболистов.");return}
 t.players.forEach((p,i)=>{
  p.skills=p.skills||{};
  stats.forEach(s=>{if(!Number.isFinite(Number(p.skills[s])))p.skills[s]=0});
  const main=stats.includes(p.position)?p.position:"ПЗ";
  const choices=i===mainIndex?[main]:stats.filter(s=>s!==main);
  const chosen=choices[Math.floor(Math.random()*choices.length)];
  const before=Number(p.skills[chosen])||0;
  p.skills[chosen]=Math.min(100,before+1);
  if(chosen===main&&p.skills[chosen]>before&&typeof processScoutAttributeIncrease==="function")processScoutAttributeIncrease(t,p,before,p.skills[chosen]);
  results.push({name:p.name,position:main,stat:chosen,main:i===mainIndex,atCap:before>=100});
 });
 state.trainingCooldowns[key]=Date.now();state.teamTrainingHistory=state.teamTrainingHistory||[];
 state.teamTrainingHistory.push({at:Date.now(),team:t.id,results});
 if(typeof publishCoachEventOnce==="function")publishCoachEventOnce("team-training:"+state.seasonNumber+":"+state.gameDay+":"+Date.now(),"news","Командная тренировка завершена","Командная тренировка завершена. Все футболисты получили развитие характеристик.");
 if(typeof addCoachRatingPoints==="function")addCoachRatingPoints(5,"team-training");if(typeof updateCoachRespect==="function")updateCoachRespect();
 awardTrainerXp(1000);saveState();
 const ov=document.createElement("div");ov.className="feature-game-overlay";const m=document.createElement("section");m.className="feature-game-modal";const body=document.createElement("div");body.className="feature-player-list";
 results.forEach(r=>{const row=document.createElement("div");row.className="feature-player-row";row.append(safeText("b",r.name+" · "+r.position),safeText("span",(r.main?"Основная позиция":"Случайная характеристика")+" → "+r.stat+(r.atCap?" (уже 100)":" +1")));body.append(row)});
 const close=()=>{ov.remove();openPage("training")};m.append(safeText("h2","⚽ Командная тренировка завершена"),T("Каждый футболист получил одну случайно распределённую попытку развития. Начислено +1000 XP тренеру."),body,B("Готово",close,"primary"));ov.append(m);document.body.append(ov)
}
function playTraining(t,p,id){
 const ov=document.createElement("div");ov.className="feature-game-overlay";
 const m=document.createElement("section");m.className="feature-game-modal";
 const title=p.position==="ВР"?"🧤 ВРАТАРЬ: ПОЙМАЙ МЯЧ":p.position==="ЗЩ"?"🛡️ ЗАЩИТНИК: ПЕРЕХВАТ":"🐍 ФУТБОЛЬНАЯ ЗМЕЙКА";
 const scoreLine=safeText("p","Очки: 0","feature-game-stats"),field=document.createElement("div");field.className="training-playfield football-training-field";
 const hint=safeText("p",p.position==="ВР"?"Двигай вратаря влево-вправо и лови мячи. 10 пропущенных мячей — игра окончена.":p.position==="ЗЩ"?"Лови мяч, пока он виден. Каждый мяч появляется примерно на секунду.":"Собирай мячи и избегай футболистов.","feature-game-message");
 const actions=document.createElement("div");actions.className="feature-actions";ov.append(m);m.append(safeText("h2",title),T(p.name),scoreLine,field,hint,actions);document.body.append(ov);
 let score=0,miss=0,ended=false,closed=false,timer=null,raf=0,keys=new Set(),extraCleanup=()=>{};
 const close=()=>{if(closed)return;closed=true;clearInterval(timer);clearTimeout(timer);cancelAnimationFrame(raf);document.removeEventListener("keydown",key);document.removeEventListener("keyup",keyup);extraCleanup();ov.remove()};
 function finish(details){
  if(ended||closed)return;
  ended=true;
  clearInterval(timer);clearTimeout(timer);cancelAnimationFrame(raf);
  document.removeEventListener("keydown",key);document.removeEventListener("keyup",keyup);
  try{extraCleanup()}catch(error){console.warn("Training cleanup error:",error)}
  const net=Math.max(0,Number(score)||0);
  const before=Number(p.skills?.[p.position]||0);
  const growth=Math.max(0,Math.min(Math.floor(net/200),100-before));
  const beforeRel=Number(state.relationships[playerRelationKey(t,p)]||0);
  const after=rel(t,p,net);
  const delta=after-beforeRel;
  p.skills=p.skills||{};
  p.skills[p.position]=Math.min(100,before+growth);
  if(growth>0&&typeof processScoutAttributeIncrease==="function")processScoutAttributeIncrease(t,p,before,p.skills[p.position]);
  awardTrainerXp(net);
  state.trainingCooldowns=state.trainingCooldowns||{};
  state.trainingCooldowns[id]=Date.now();
  state.trainingHistory=Array.isArray(state.trainingHistory)?state.trainingHistory:[];
  state.trainingHistory.push({type:"individual",team:t.id,player:p.name,playerId:p.careerId||p.id||p.name,score:net,delta,growth,at:Date.now()});
  try{if(typeof publishCoachEventOnce==="function")publishCoachEventOnce("individual-training:"+state.seasonNumber+":"+state.gameDay+":"+(p.careerId||p.id||p.name)+":"+Date.now(),"player","Индивидуальная тренировка","Тренировка с "+p.name+" завершена. Изменение отношений: "+(delta>=0?"+":"")+delta.toFixed(2)+" п.п.")}catch(error){console.warn("Training event publish error:",error)}
  try{if(typeof addCoachRatingPoints==="function")addCoachRatingPoints(1,"individual-training")}catch(error){console.warn("Training rating update error:",error)}
  try{if(typeof updateCoachRespect==="function")updateCoachRespect()}catch(error){console.warn("Training respect update error:",error)}
  let saved=true;
  try{saveState()}catch(error){saved=false;console.error("Could not save training result:",error)}
  scoreLine.textContent="Итог: "+net+" очков · Отношения "+(delta>=0?"+":"")+F(delta)+" · "+p.position+" +"+growth;
  field.replaceChildren(T(details+(saved?"":" Результат посчитан, но локальное сохранение не удалось. Не закрывай вкладку и сообщи об ошибке.")));
  actions.replaceChildren(B("Готово",()=>{close();render();openPage("training")},"primary"));
 }
 function key(ev){const k=ev.key.toLowerCase();if(["arrowleft","arrowright","arrowup","arrowdown","a","d","w","s"].includes(k)){keys.add(k);ev.preventDefault()}}
 function keyup(ev){keys.delete(ev.key.toLowerCase())}
 document.addEventListener("keydown",key);document.addEventListener("keyup",keyup);
 const controls=document.createElement("div");controls.className="football-touch-controls";
 if(p.position==="ВР"){
   field.classList.add("goalkeeper-field");const goal=document.createElement("div");goal.className="football-goal";goal.textContent="🥅";const keeper=document.createElement("div");keeper.className="goalkeeper-sprite";keeper.textContent="🧤";const ballLayer=document.createElement("div");ballLayer.className="football-ball-layer";field.append(goal,ballLayer,keeper);
   const W=100,H=100;let goalkeeper={x:50,y:87},balls=[],lastSpawn=0,last=performance.now(),ballId=0;
   function drawKeeper(){goalkeeper.x=Math.max(7,Math.min(93,goalkeeper.x));keeper.style.left=goalkeeper.x+"%"}
   function spawnBall(){const b={id:++ballId,x:8+Math.random()*84,y:8,speed:.022+Math.random()*.012};balls.push(b);const el=document.createElement("span");el.className="training-ball";el.textContent="⚽";el.dataset.ball=String(b.id);el.style.left=b.x+"%";el.style.top=b.y+"%";ballLayer.append(el)}
   function frame(now){if(ended||closed)return;const dt=Math.min(40,now-last);last=now;if(keys.has("arrowleft")||keys.has("a"))goalkeeper.x-=dt*.035;if(keys.has("arrowright")||keys.has("d"))goalkeeper.x+=dt*.035;drawKeeper();if(now-lastSpawn>850){spawnBall();lastSpawn=now}balls=balls.filter(b=>{b.y+=b.speed*dt;const el=ballLayer.querySelector('[data-ball="'+b.id+'"]');if(el){el.style.top=b.y+"%";el.style.left=b.x+"%"}if(b.y>=82){if(el)el.remove();if(Math.abs(b.x-goalkeeper.x)<=11){score+=5;scoreLine.textContent="Очки: "+score+" · Голы: "+miss+"/10"}else{miss++;scoreLine.textContent="Очки: "+score+" · Пропущено: "+miss+"/10"}if(miss>=10){finish("10 голов пропущено. Поймано мячей: "+score/5+".");return false}return false}return true});raf=requestAnimationFrame(frame)}
   field.addEventListener("pointermove",ev=>{const r=field.getBoundingClientRect();if(r.width>0)goalkeeper.x=((ev.clientX-r.left)/r.width)*100;drawKeeper()});actions.append(B("ЗАВЕРШИТЬ И СОХРАНИТЬ",()=>finish("Результат сохранён по решению тренера. Поймано мячей: "+score/5+"."),"primary"));drawKeeper();raf=requestAnimationFrame(frame);
 }else if(p.position==="ЗЩ"){
   field.classList.add("defender-field");let round=0,active=false,target=null,missed=0;
   const status=safeText("p","Приготовься…","defender-round");field.append(status);
   function spawn(){if(ended||closed)return;round++;active=true;target=B("⚽",()=>{if(!active||ended)return;active=false;clearTimeout(timer);target?.remove();target=null;score+=5;scoreLine.textContent="Очки: "+score+" · Перехваты: "+(score/5)+" · Промахи: "+missed+"/1";status.textContent="Отличный перехват!";timer=setTimeout(spawn,350)},"defender-ball-target");target.style.left=(8+Math.random()*78)+"%";target.style.top=(12+Math.random()*58)+"%";field.append(target);status.textContent="Мяч "+round+" — нажми на него, пока он виден!";timer=setTimeout(()=>{if(!active||ended)return;active=false;missed++;target?.remove();target=null;scoreLine.textContent="Очки: "+score+" · Промахи: "+missed+"/1";status.textContent=missed>=1?"Первый промах — результат сохранён.":"Не успел! Следующий мяч…";if(missed>=1){finish("Первый промах. Перехвачено мячей: "+score/5+".");return}timer=setTimeout(spawn,350)},1000)}
   actions.append(B("СОХРАНИТЬ РЕЗУЛЬТАТ И ВЫЙТИ",()=>finish("Результат сохранён по решению тренера. Перехвачено мячей: "+score/5+"."),"primary"));
   timer=setTimeout(spawn,500);
 }else{
   field.classList.add("snake-training-field");const grid=document.createElement("div");grid.className="snake-grid";grid.style.touchAction="none";field.append(grid);
   const SIZE=20;let snake=[{x:10,y:10},{x:9,y:10}],dir={x:1,y:0},food={x:14,y:10},obstacles=[];
   function freeCell(){for(let i=0;i<500;i++){const p={x:Math.floor(Math.random()*SIZE),y:Math.floor(Math.random()*SIZE)};if(!snake.some(s=>s.x===p.x&&s.y===p.y)&&!(food.x===p.x&&food.y===p.y)&&!obstacles.some(s=>s.x===p.x&&s.y===p.y))return p}return null}
   function placeFood(){const p=freeCell();if(p)food=p}
   function draw(){grid.replaceChildren();for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){const c=document.createElement("span");c.className="snake-cell"+(snake.some(s=>s.x===x&&s.y===y)?" snake-body":"")+(food.x===x&&food.y===y?" snake-food":"")+(obstacles.some(s=>s.x===x&&s.y===y)?" snake-obstacle":"");c.textContent=food.x===x&&food.y===y?"⚽":obstacles.some(s=>s.x===x&&s.y===y)?"🧍":"";grid.append(c)}scoreLine.textContent="Очки: "+score+" · Мячей: "+score/5}
   function tick(){if(ended||closed)return;const h={x:snake[0].x+dir.x,y:snake[0].y+dir.y};if(h.x<0||h.y<0||h.x>=SIZE||h.y>=SIZE||snake.slice(0,-1).some(s=>s.x===h.x&&s.y===h.y)||obstacles.some(s=>s.x===h.x&&s.y===h.y)){finish("Змейка столкнулась с футболистом или границей. Собрано мячей: "+score/5+".");return}snake.unshift(h);if(h.x===food.x&&h.y===food.y){score+=5;placeFood();if(score%50===0&&obstacles.length<12){const o=freeCell();if(o)obstacles.push(o)}}else snake.pop();draw()}
   function setDirection(dx,dy){if(!(dx===-dir.x&&dy===-dir.y))dir={x:dx,y:dy}}
   function keySnake(ev){const target=ev.target;if(target&&(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))return;const map={arrowup:[0,-1],arrowdown:[0,1],arrowleft:[-1,0],arrowright:[1,0],w:[0,-1],s:[0,1],a:[-1,0],d:[1,0]},v=map[String(ev.key||"").toLowerCase()];if(v){setDirection(v[0],v[1]);ev.preventDefault()}}
   let swipeStart=null;grid.addEventListener("pointerdown",ev=>{swipeStart={x:ev.clientX,y:ev.clientY};try{grid.setPointerCapture(ev.pointerId)}catch(_){}});grid.addEventListener("pointerup",ev=>{if(!swipeStart)return;const dx=ev.clientX-swipeStart.x,dy=ev.clientY-swipeStart.y;swipeStart=null;if(Math.max(Math.abs(dx),Math.abs(dy))<12)return;if(Math.abs(dx)>Math.abs(dy))setDirection(dx>0?1:-1,0);else setDirection(0,dy>0?1:-1)});grid.addEventListener("pointercancel",()=>{swipeStart=null});
   const touchPad=document.createElement("div");touchPad.className="snake-touch-pad";touchPad.setAttribute("aria-label","Сенсорное управление змейкой");[["↑",0,-1,"up"],["←",-1,0,"left"],["↓",0,1,"down"],["→",1,0,"right"]].forEach(([label,dx,dy,place])=>{const b=B(label,()=>setDirection(dx,dy),"secondary");b.classList.add("snake-touch-button", "snake-touch-"+place);b.setAttribute("aria-label",({up:"Вверх",left:"Влево",down:"Вниз",right:"Вправо"})[place]);touchPad.append(b)});field.append(touchPad);
   document.addEventListener("keydown",keySnake);extraCleanup=()=>document.removeEventListener("keydown",keySnake);
   timer=setInterval(tick,180);draw();
   actions.append(B("Выйти без награды",close));
 }
 if(p.position!=="ЗЩ"&&p.position!=="ВР") actions.append(B("Выйти без награды",close));
}
function transfersPage(){
 const w=document.createElement("div");
 if(!leagueData){w.append(placeholder("Загружаю команды…"));return w}
 Object.entries(state.externalRosters||{}).forEach(([id,players])=>{
  const team=leagueData.teams.find(x=>x.id===id);
  if(team&&Array.isArray(players))team.players=players;
 });
 if(state.transferTarget){
  const team=leagueData.teams.find(x=>x.id===state.transferTarget.team);
  const player=team?.players.find(x=>x.name===state.transferTarget.name);
  if(team&&player){
   const relation=Number(getPlayerRelation(team,player));
   if(relation<50){
    delete state.transferTarget;saveState();
    alert("Для обмена нужны отношения с футболистом не ниже 50%.");
   }else{
    const panel=P("Обмен игроками","Отношения с "+player.name+": "+F(relation)+". Выбери футболиста своей команды для обмена.");
    const select=document.createElement("select");select.className="league-select";
    own().forEach((x,i)=>select.add(new Option(x.name+" · "+x.position,String(i))));
    const confirmExchange=()=>{
     const i=Number(select.value),mine=own()[i];
     if(!mine||!confirm("Предложить обмен: "+mine.name+" на "+player.name+"?"))return;
     if(relation<70){
      alert("Наш футболист не хочет, и мы сами не можем согласиться на этот обмен. Налаживайте с ним отношения сами.");
      delete state.transferTarget;saveState();openPage("transfers");return;
     }
     if(relation<90&&Math.random()>=0.5){
      const reason=Math.random()<0.5?"Футболист отказался от обмена. Попробуйте наладить отношения ещё лучше.":"Тренер команды отказал в обмене. Налаживайте отношения с футболистом дальше.";
      alert(reason);delete state.transferTarget;saveState();openPage("transfers");return;
     }
     const userTeam=getUserTeam(),targetIndex=team.players.findIndex(x=>x.name===player.name);
     if(targetIndex<0||!userTeam.players[i]){alert("Не удалось завершить обмен: состав изменился.");return}
     userTeam.players.splice(i,1);team.players.splice(targetIndex,1);
     userTeam.players.push({...player});team.players.push({...mine});
     state.userRoster=userTeam.players;state.externalRosters[team.id]=team.players;
     state.transferHistory.push({team:team.id,received:player.name,given:mine.name,at:Date.now(),relation,success:true});
     delete state.transferTarget;saveState();alert("Обмен успешно состоялся!");openPage("transfers");
    };
    panel.append(select,B("Попробовать обмен",confirmExchange,"primary"),B("Отмена",()=>{delete state.transferTarget;openPage("transfers")}));
    w.append(panel);return w;
   }
  }
 }
 w.append(P("Трансферный обмен игроками","Обмен открывается при отношениях от 50%. От 50% до менее 70% — гарантированный отказ; от 70% до менее 90% — шанс согласия 50%; от 90% — обмен гарантирован."));
 leagueData.teams.filter(t=>t.id!==getUserTeam()?.id).forEach(team=>{
  const panel=P(team.name,team.league);
  team.players.forEach(player=>{
   const relation=Number(getPlayerRelation(team,player));
   const row=document.createElement("div");row.className="feature-player-row";
   const label=safeText("span",player.name+" · "+player.position+" · "+F(relation));
   const profile=B("Профиль",()=>openPlayerProfile(team,player,teamsPlayerIndex(team,player)));
   const exchangeLabel=relation<50?"Обмен закрыт — нужно 50%":relation<70?"Попробовать обмен (отказ до 70%)":relation<90?"Попробовать обмен (50/50)":"Обмен гарантирован";
   const exchange=B(exchangeLabel,()=>{if(relation<50)return;state.transferTarget={team:team.id,name:player.name};saveState();openPage("transfers")},relation>=50?"primary":"secondary");
   exchange.disabled=relation<50;
   row.append(label,profile,exchange);panel.append(row);
  });
  w.append(panel);
 });
 const npcHistory = Array.isArray(state.npcTransferHistory) ? state.npcTransferHistory : [];
 const availableSeasons = [...new Set(npcHistory.map(item => Math.max(1, Number(item.season) || 1)))].sort((a,b)=>b-a);
 const archive = P("История обменов команд", "Здесь сохраняются реальные взаимные обмены между командами NPC. История не меняет правила пользовательского обмена.");
 if (!availableSeasons.length) {
  archive.append(T("Обменов между командами NPC пока не было. Новости появятся после фактически состоявшихся сделок."));
 } else {
  const tabs = document.createElement("div"); tabs.className = "feature-actions";
  const list = document.createElement("div");
  function showSeason(season) {
   list.replaceChildren();
   const rows = npcHistory.filter(item => Number(item.season) === Number(season)).sort((a,b)=>(Number(b.day)||0)-(Number(a.day)||0));
   if (!rows.length) { list.append(T("В этом сезоне обменов не было.")); return; }
   rows.forEach(item => {
    const card = document.createElement("article"); card.className = "feature-panel";
    card.append(safeText("h3", "Сезон " + item.season + " · игровой день " + item.day));
    card.append(T(item.teamAName + " ↔ " + item.teamBName));
    card.append(T(item.playerAName + " перешёл в «" + item.teamBName + "», а " + item.playerBName + " — в «" + item.teamAName + "»."));
    list.append(card);
   });
  }
  availableSeasons.forEach((season, index) => tabs.append(B("Сезон " + season, () => showSeason(season), index === 0 ? "primary" : "secondary")));
  archive.append(tabs, list); showSeason(availableSeasons[0]);
 }
 w.append(archive);
 return w;
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install);else install();
})();

/* Футбольная тема для индивидуальных мини-игр */