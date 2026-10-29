(function(){
"use strict";
const cd=3600000,icons=["⚽","🧤","👟","👕","🏆","🥅"];let timer=null,profileBase;
const B=(s,fn,c="secondary")=>{const b=document.createElement("button");b.type="button";b.className=c;b.textContent=s;b.onclick=fn;return b},T=(s)=>safeText("p",s,"muted"),P=(a,b)=>{const e=document.createElement("section");e.className="feature-panel";e.append(safeText("h2",a),T(b));return e},F=n=>(Math.round(n*100)/100).toLocaleString("ru-RU",{maximumFractionDigits:2})+"%",own=()=>getUserTeam()?.players||[];
function rel(t,p,n){state.relationships||={};let k=playerRelationKey(t,p),before=Number(state.relationships[k]||0),v=Math.max(0,Math.min(100,before+n/100));state.relationships[k]=v;if(v>before){state.relationshipHistory=Array.isArray(state.relationshipHistory)?state.relationshipHistory:[];state.relationshipHistory.push({team:t.id,playerId:p.careerId||p.id||p.name,player:p.name,after:v,at:Date.now()})}return v}
function transfer(){openPage("transfers")}
function install(){
 state.relationships||={};state.trainingCooldowns||={};state.trainingHistory||=[];state.transferHistory||=[];state.externalRosters||={};state.coachGoals||={};
 const baseGetTeam=getUserTeam;
 getUserTeam=function(){const t=baseGetTeam();if(t&&Array.isArray(state.userRoster))t.players=state.userRoster;return t};

 const nav=document.querySelector(".menu-grid");if(nav&&!nav.querySelector('[data-page="transfers"]')&&!document.getElementById("transferHome")){const b=B("🔁 ТРАНСФЕРНЫЙ ОБМЕН ИГРОКАМИ",transfer,"transfer-home-button");b.id="transferHome";nav.append(b)}
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
    state.xp=Math.max(0,Number(state.xp)||0)+goal.reward;record.completedAt=now;record.rewardedAt=now;record.lastReward=goal.reward;saveState();
    w.append(P("Цель выполнена!",goal.title+" — начислено "+goal.reward.toLocaleString("ru-RU")+" XP. Следующее выполнение доступно через 20 часов."));return;
   }
   const card=P(goal.title,goal.description),line=locked?"Повторно доступна через "+Math.ceil((unlock-now)/3600000)+" ч. "+Math.ceil(((unlock-now)%3600000)/60000)+" мин.":"Прогресс: "+progress.current+" / "+progress.total;
   card.append(T("Награда: "+goal.reward.toLocaleString("ru-RU")+" XP"),T(line));if(!locked&&progress.done)card.append(T("Цель выполнена. Награда будет начислена при обновлении целей."));w.append(card);
  });return w
 }
 function freeYardMonthKey(){const day=Math.max(1,Number(state.gameDay)||1),season=Math.max(1,Number(state.seasonNumber)||1);return season+":"+ (Math.floor((day-1)/28)+1)}
function randomFreeYardPlayer(){
 const all=[];(leagueData?.teams||[]).forEach(team=>(team.players||[]).forEach(player=>{const parts=String(player.name||"").trim().split(/\s+/);if(parts.length>1)all.push({first:parts.slice(1).join(" "),last:parts[0]})}));
 const firsts=[...new Set(all.map(x=>x.first).filter(Boolean))],lasts=[...new Set(all.map(x=>x.last).filter(Boolean))];
 const first=firsts[Math.floor(Math.random()*firsts.length)]||"Алексей",last=lasts[Math.floor(Math.random()*lasts.length)]||"Смирнов";
 const position=["ВР","ЗЩ","ПЗ","НП"][Math.floor(Math.random()*4)],skills={ВР:15+Math.floor(Math.random()*56),ЗЩ:15+Math.floor(Math.random()*56),ПЗ:15+Math.floor(Math.random()*56),НП:15+Math.floor(Math.random()*56)};
 skills[position]=Math.min(75,skills[position]+8);
 return {id:"free-"+Date.now()+"-"+Math.random().toString(36).slice(2,8),name:last+" "+first,position,nationality:"Россия",age:14+Math.floor(Math.random()*7),skills,potential:35+Math.floor(Math.random()*56),portraitIndex:1+Math.floor(Math.random()*77),freeYard:true,invited:false};
}
function ensureFreeYardPlayer(){
 state.freeYardPlayers=Array.isArray(state.freeYardPlayers)?state.freeYardPlayers:[];
 state.freeYardMonthsSeen=Array.isArray(state.freeYardMonthsSeen)?state.freeYardMonthsSeen:[];
 const month=freeYardMonthKey();
 if(!state.freeYardMonthsSeen.includes(month)){state.freeYardPlayers.push({...randomFreeYardPlayer(),monthKey:month});state.freeYardMonthsSeen.push(month);saveState()}
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
  actions.append(B("Познакомиться (+10%)",()=>{const current=Math.max(0,Math.min(100,Number(state.relationships[relationKey]||0)));state.relationships[relationKey]=Math.min(100,current+10);saveState();openPage("freeyard")},"secondary"));
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
 function saveAndExit(){if(done||closed)return;done=true;clearTimeout(timer);const before=Number(state.relationships[playerRelationKey(t,p)]||0),after=rel(t,p,score),delta=after-before;state.xp=Math.max(0,Number(state.xp)||0)+score;state.trainingHistory=Array.isArray(state.trainingHistory)?state.trainingHistory:[];state.trainingHistory.push({type:"match3-relations",team:t.id,player:p.name,score,delta,at:Date.now()});saveState();msg.textContent="Результат сохранён. Очки: "+score+". Отношения с игроком: +"+F(delta)+". Общие отношения: "+F(after)+".";grid.replaceChildren();actions.replaceChildren(B("Вернуться в профиль",()=>{close();openPlayerProfile(t,p,0)},"primary"),B("Закрыть",close))}
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
  results.push({name:p.name,position:main,stat:chosen,main:i===mainIndex,atCap:before>=100});
 });
 state.trainingCooldowns[key]=Date.now();state.teamTrainingHistory=state.teamTrainingHistory||[];
 state.teamTrainingHistory.push({at:Date.now(),team:t.id,results});
 state.xp=Math.max(0,Number(state.xp)||0)+1000;saveState();
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
 function finish(details){if(ended||closed)return;ended=true;clearInterval(timer);clearTimeout(timer);cancelAnimationFrame(raf);document.removeEventListener("keydown",key);document.removeEventListener("keyup",keyup);extraCleanup();let net=Math.max(0,score),before=Number(p.skills?.[p.position]||0),growth=Math.min(Math.floor(net/200),100-before),beforeRel=Number(state.relationships[playerRelationKey(t,p)]||0),after=rel(t,p,score);p.skills=p.skills||{};p.skills[p.position]=Math.min(100,before+growth);state.xp=Math.max(0,Number(state.xp)||0)+net;state.trainingCooldowns[id]=Date.now();state.trainingHistory=Array.isArray(state.trainingHistory)?state.trainingHistory:[];state.trainingHistory.push({type:"individual",team:t.id,player:p.name,playerId:p.careerId||p.id||p.name,score,delta:after-beforeRel,growth,at:Date.now()});saveState();scoreLine.textContent="Итог: "+score+" очков · Отношения +"+F(after-beforeRel)+" · "+p.position+" +"+growth;field.replaceChildren(T(details));actions.replaceChildren(B("Готово",()=>{close();openPage("training")},"primary"))}
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
   field.addEventListener("pointermove",ev=>{const r=field.getBoundingClientRect();goalkeeper.x=((ev.clientX-r.left)/r.width)*100;drawKeeper()});drawKeeper();raf=requestAnimationFrame(frame);
 }else if(p.position==="ЗЩ"){
   field.classList.add("defender-field");let round=0,active=false,target=null,missed=0;
   const status=safeText("p","Приготовься…","defender-round");field.append(status);
   function spawn(){if(ended||closed)return;round++;active=true;target=B("⚽",()=>{if(!active||ended)return;active=false;clearTimeout(timer);target?.remove();target=null;score+=5;scoreLine.textContent="Очки: "+score+" · Перехваты: "+(score/5)+" · Промахи: "+missed+"/3";status.textContent="Отличный перехват!";timer=setTimeout(spawn,350)},"defender-ball-target");target.style.left=(8+Math.random()*78)+"%";target.style.top=(12+Math.random()*58)+"%";field.append(target);status.textContent="Мяч "+round+" — нажми на него, пока он виден!";timer=setTimeout(()=>{if(!active||ended)return;active=false;missed++;target?.remove();target=null;scoreLine.textContent="Очки: "+score+" · Промахи: "+missed+"/3";status.textContent=missed>=3?"Три промаха — результат сохранён.":"Не успел! Следующий мяч…";if(missed>=3){finish("Три промаха. Перехвачено мячей: "+score/5+".");return}timer=setTimeout(spawn,350)},1000)}
   actions.append(B("СОХРАНИТЬ РЕЗУЛЬТАТ И ВЫЙТИ",()=>finish("Результат сохранён по решению тренера. Перехвачено мячей: "+score/5+"."),"primary"));
   timer=setTimeout(spawn,500);
 }else{
   field.classList.add("snake-training-field");const grid=document.createElement("div");grid.className="snake-grid";grid.style.touchAction="none";field.append(grid);
   let snake=[{x:4,y:4},{x:3,y:4}],dir={x:1,y:0},food={x:7,y:4},obstacles=[];
   function placeFood(){let tries=0;do{food={x:Math.floor(Math.random()*10),y:Math.floor(Math.random()*10)};tries++}while(tries<200&&(snake.some(s=>s.x===food.x&&s.y===food.y)||obstacles.some(s=>s.x===food.x&&s.y===food.y)))}
   function draw(){grid.replaceChildren();for(let y=0;y<10;y++)for(let x=0;x<10;x++){const c=document.createElement("span");c.className="snake-cell"+(snake.some(s=>s.x===x&&s.y===y)?" snake-body":"")+(food.x===x&&food.y===y?" snake-food":"")+(obstacles.some(s=>s.x===x&&s.y===y)?" snake-obstacle":"");c.textContent=food.x===x&&food.y===y?"⚽":obstacles.some(s=>s.x===x&&s.y===y)?"🧍":"";grid.append(c)}scoreLine.textContent="Очки: "+score+" · Мячей: "+score/5}
   function tick(){if(ended||closed)return;const h={x:snake[0].x+dir.x,y:snake[0].y+dir.y};if(h.x<0||h.y<0||h.x>=10||h.y>=10||snake.slice(0,-1).some(s=>s.x===h.x&&s.y===h.y)||obstacles.some(s=>s.x===h.x&&s.y===h.y)){finish("Змейка столкнулась с футболистом или границей. Собрано мячей: "+score/5+".");return}snake.unshift(h);if(h.x===food.x&&h.y===food.y){score+=5;placeFood();if(score%50===0&&obstacles.length<8){let o;do{o={x:Math.floor(Math.random()*10),y:Math.floor(Math.random()*10)}}while((snake.some(s=>s.x===o.x&&s.y===o.y)||(food.x===o.x&&food.y===o.y)||obstacles.some(s=>s.x===o.x&&s.y===o.y)));obstacles.push(o)}}else snake.pop();draw()}
   function setDirection(dx,dy){if(!(dx===-dir.x&&dy===-dir.y))dir={x:dx,y:dy}}
   function keySnake(ev){const map={arrowup:[0,-1],arrowdown:[0,1],arrowleft:[-1,0],arrowright:[1,0],w:[0,-1],s:[0,1],a:[-1,0],d:[1,0]},v=map[ev.key.toLowerCase()];if(v){setDirection(v[0],v[1]);ev.preventDefault()}}
   let swipeStart=null;grid.addEventListener("pointerdown",ev=>{swipeStart={x:ev.clientX,y:ev.clientY};try{grid.setPointerCapture(ev.pointerId)}catch(_){}});grid.addEventListener("pointerup",ev=>{if(!swipeStart)return;const dx=ev.clientX-swipeStart.x,dy=ev.clientY-swipeStart.y;swipeStart=null;if(Math.max(Math.abs(dx),Math.abs(dy))<12)return;if(Math.abs(dx)>Math.abs(dy))setDirection(dx>0?1:-1,0);else setDirection(0,dy>0?1:-1)});grid.addEventListener("pointercancel",()=>{swipeStart=null});
   document.addEventListener("keydown",keySnake);extraCleanup=()=>document.removeEventListener("keydown",keySnake);
   timer=setInterval(tick,280);draw();
   actions.append(B("Выйти без награды",close));
 }
 if(p.position!=="ЗЩ"&&p.position!=="ВР") actions.append(B("Выйти без награды",close));
}
function transfersPage(){
 const w=document.createElement("div");if(!leagueData){w.append(placeholder("Загружаю команды…"));return w} Object.entries(state.externalRosters||{}).forEach(([id,players])=>{const t=leagueData.teams.find(x=>x.id===id);if(t&&Array.isArray(players))t.players=players});
 if(state.transferTarget){const t=leagueData.teams.find(x=>x.id===state.transferTarget.team),p=t?.players.find(x=>x.name===state.transferTarget.name);if(t&&p){const relation=Number(getPlayerRelation(t,p));if(relation<50){delete state.transferTarget;saveState();alert("Для обмена нужны отношения с футболистом не ниже 50%.");}else{const panel=P("Обмен игроками","Отношения с "+p.name+": "+F(relation)+". Выбери футболиста своей команды для обмена.");const sel=document.createElement("select");sel.className="league-select";own().forEach((x,i)=>sel.add(new Option(x.name+" · "+x.position,String(i))));panel.append(sel,B("Попробовать обмен",()=>{const i=+sel.value,mine=own()[i];if(!mine||!confirm("Предложить обмен: "+mine.name+" на "+p.name+"?"))return;if(relation<70){alert("Наш футболист не хочет, и мы сами не можем согласиться на этот обмен. Налаживайте с ним отношения сами.");delete state.transferTarget;saveState();openPage("transfers");return}if(relation<90&&Math.random()>=0.5){alert(Math.random()<0.5?"Футболист отказался от обмена. Попробуйте наладить отношения ещё лучше.":"Тренер команды отказал в обмене. Налаживайте отношения с футболистом дальше.");delete state.transferTarget;saveState();openPage("transfers");return}const ut=getUserTeam(),idx=t.players.findIndex(x=>x.name===p.name);if(idx<0||!ut.players[i]){alert("Не удалось завершить обмен: состав изменился.");return}ut.players.splice(i,1);t.players.splice(idx,1);ut.players.push({...p});t.players.push({...mine});state.userRoster=ut.players;state.externalRosters[t.id]=t.players;state.transferHistory.push({team:t.id,received:p.name,given:mine.name,at:Date.now(),relation,success:true});delete state.transferTarget;saveState();alert("Обмен успешно состоялся!");openPage("transfers")},"primary"),B("Отмена",()=>{delete state.transferTarget;openPage("transfers")}));w.append(panel);return w}}
  w.append(P("Трансферный обмен игроками","Обмен открывается при отношениях от 50%. От 50% до менее 70% — гарантированный отказ; от 70% до менее 90% — шанс согласия 50%; от 90% — обмен гарантирован."));
  leagueData.teams.filter(t=>t.id!==getUserTeam()?.id).forEach(t=>{const p=P(t.name,t.league);t.players.forEach(x=>{const relation=Number(getPlayerRelation(t,x));const r=document.createElement("div");r.className="feature-player-row";const label=safeText("span",x.name+" · "+x.position+" · "+F(relation));const profile=B("Профиль",()=>openPlayerProfile(t,x,teamsPlayerIndex(t,x)));const exchange=B(relation<50?"Обмен закрыт — нужно 50%":relation<70?"Обмен недоступен — нужно 70%":relation<90?"Попробовать обмен (50/50)":"Обмен гарантирован",()=>{if(relation<50)return;state.transferTarget={team:t.id,name:x.name};saveState();openPage("transfers")},relation>=50?"primary":"secondary");exchange.disabled=relation<50;r.append(label,profile,exchange);p.append(r)});w.append(p)});return w
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install);else install();
})();

/* Футбольная тема для индивидуальных мини-игр */
