/* 喊呗 HeyBay · HTML 演示原型
   纯前端演示：真实产品的这些列表来自云数据库，动作经云函数事务写入。 */

const S = { screen: 'home', picked: false, parsed: false, lad: 'L1', stars: 0, tags: [], chat: [] };

const el = id => document.getElementById(id);
const screenBox = el('screen');

/* ---------------- 演示数据 ---------------- */
const REQS = [
  { id: 'r1', cat: '搭子同行', k: '', title: '9/12 上午想找人一起逛大英博物馆', detail: '中文交流，女生优先。逛完可以一起吃个午饭，费用各付。',
    timing: '预约型 · 9/12 10:00', plan: true, area: '大英博物馆 / 罗素广场一带', pay: '免费互助', free: true,
    who: '林悦', av: 'p', badge: 'b2', badgeTx: '靠谱', resp: 3, safe: '仅同性响应' },
  { id: 'r2', cat: '打听咨询', k: 'b', title: '现在在国王十字，附近哪里能买到电话卡？', detail: '刚落地，需要能打电话的实体卡，不要 eSIM。',
    timing: '即时型 · 剩 42 分钟', plan: false, area: '国王十字车站', pay: '免费互助', free: true,
    who: '周航', av: '', badge: 'b1', badgeTx: '新面孔', resp: 0, ai: true },
  { id: 'r3', cat: '付费地陪', k: 'c', title: '9/13 伦敦一日游地陪，需要会拍照', detail: '两个人，想去塔桥、格林威治，希望能帮拍出片的照片。',
    timing: '预约型 · 9/13 全天', plan: true, area: '市中心 + 格林威治', pay: '£80', free: false,
    who: '林悦', av: 'p', badge: 'b2', badgeTx: '靠谱', resp: 2 },
  { id: 'r4', cat: '借物易物', k: '', title: '借个英标转换插头，用两天', detail: '住在国王十字附近，可以请杯咖啡或者用国标插头换。',
    timing: '即时型 · 今天内', plan: false, area: '国王十字 / 卡姆登', pay: '请一顿', free: true,
    who: '苏眠', av: 't', badge: 'b3', badgeTx: '老手', resp: 1 },
  { id: 'r5', cat: '搭子同行', k: '', title: '今晚拼车去希思罗 T5', detail: '20:30 从帕丁顿出发，两个人两个箱子，车费平摊。',
    timing: '即时型 · 剩 3 小时', plan: false, area: '帕丁顿 → 希思罗', pay: '免费互助', free: true,
    who: '陈默', av: 't', badge: 'b2', badgeTx: '靠谱', resp: 1 },
  { id: 'r6', cat: '代购跑腿', k: 'd', title: '帮带一盒 Boots 维生素回国', detail: '9/20 前从伦敦飞北京的朋友，代购费好商量。',
    timing: '预约型 · 9/20 前', plan: true, area: '不限', pay: '£10', free: false,
    who: '苏眠', av: 't', badge: 'b3', badgeTx: '老手', resp: 4 }
];

const RESPONDERS = [
  { name: '陈默', av: 't', badge: 'b2', badgeTx: '靠谱', say: '我 UCL 研二，博物馆去过五六次，可以带你走重点馆藏，中文讲解。周五上午没课。',
    evi: ['已完成 12 单', '好评率 100%', '平均 18 分钟响应', 'UCL 邮箱已验证'], quote: '免费互助',
    reason: '同城伦敦 · 能力标签含「带路 / 讲解」· 完成 12 单且好评率 100% · 平均响应 18 分钟，是当前候选里最快的' },
  { name: '苏眠', av: 'p', badge: 'b3', badgeTx: '老手', say: '在伦敦第四年，做过 30 多次陪同，可以顺便帮你拍照。',
    evi: ['已完成 31 单', '好评率 97%', '平均 41 分钟响应', 'KCL 邮箱已验证', '社媒已绑定'], quote: '免费互助',
    reason: '同城伦敦 · 完成单数最多（31 单）· 能力标签含「拍照」，与你详情里提到的需求相关' },
  { name: '阿哲', av: '', badge: 'b1', badgeTx: '新面孔', say: '刚来伦敦，也想去博物馆，可以一起。',
    evi: ['已完成 0 单', '资料完整度 60%'], quote: '免费互助',
    reason: '同城伦敦 · 尚无履约记录，排在最后；平台不会因为「新」而隐藏他，但会如实标注证据不足' }
];

/* ---------------- 工具 ---------------- */
const reqCard = r => `
  <div class="rq" onclick="go('detail')">
    <div class="rq-top">
      <span class="cat ${r.k}">${r.cat}</span>
      <span class="timer ${r.plan ? 'plan' : ''}">${r.timing}</span>
      ${r.safe ? `<span class="badge b3">${r.safe}</span>` : ''}
    </div>
    <h4>${r.title}</h4>
    <p>${r.detail}</p>
    <div class="rq-meta"><span>📍 ${r.area}</span><span>👀 ${r.resp} 人响应</span></div>
    <div class="rq-foot">
      <span class="who-mini"><i class="av ${r.av}">${r.who[0]}</i>${r.who}<span class="badge ${r.badge}">${r.badgeTx}</span></span>
      <span class="pay ${r.free ? 'free' : ''}">${r.pay}</span>
    </div>
  </div>`;

function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  el('screen').parentElement.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function closeModal() { document.querySelectorAll('.modal').forEach(m => m.remove()); }

function modal(html) {
  closeModal();
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal-in">${html}</div>`;
  m.addEventListener('click', e => { if (e.target === m) closeModal(); });
  el('screen').parentElement.appendChild(m);
}

/* ---------------- 屏幕 ---------------- */
const SCREENS = {};

SCREENS.publish = {
  title: '喊一声', tab: 'publish', chip: '喊一声 · AI 解析',
  notes: [
    ['key', '首屏只有一个输入框，不是表单', '表单是解析后的<b>结果</b>，不是输入的起点。V2.0 把需求方的门槛压到「一句话」，因为需求方是流动的、不会为填表付出耐心。'],
    ['warn', '四类字段 AI 一律不代填', '金额、见面时间、见面地点、联系方式——即使模型有推测也留空高亮，提示「这几项请你自己确认」。这四项是对现实世界的承诺，代价由用户承担。Schema、规范化层、发布校验三道防线。'],
    ['', '解析失败不阻断', '最多追问 2 轮，之后降级为普通表单。AI 是加速器不是关卡。'],
    ['key', '把不可见的分发过程可视化', '底部实时展示「发出后将推送给伦敦 23 位可能帮上你的人」。这是提升发布意愿的关键——用户最担心的是「发了没人看」。'],
    ['', '归不进 8 类就留空', '品类是白名单。曾经 Schema 把 category 设成必填，结果擦边交友被硬塞进「搭子同行」，正撞产品红线。离线评测的两条擦边用例把它抓了出来。']
  ],
  render: () => S.parsed ? parsedView() : `
    <div class="s-pad">
      <div class="s-t">想找人做什么？<span>一句话说清就行</span></div>
      <textarea class="s-input" id="pubText" rows="4" placeholder="例如：明天上午想找个人一起逛大英博物馆，中文，女生优先"></textarea>
      <div class="chips-ex">
        <button onclick="fillEx(0)">逛大英博物馆找个搭子</button>
        <button onclick="fillEx(1)">现在要买电话卡</button>
        <button onclick="fillEx(2)">找地陪带一天还要拍照</button>
        <button onclick="fillEx(3)">想找个异性一起玩</button>
      </div>
      <button class="s-btn" onclick="doParse()">🐚 帮我整理</button>
      <button class="s-btn ghost sm" style="margin-top:9px" onclick="toast('已切换到普通表单：AI 是加速器，不是关卡')">跳过 AI，我自己填表</button>
      <div class="s-t">小螺能帮上的</div>
      <p class="s-hint">把口语整理成结构化需求单 · 生成 ≤20 字标题 · 判断预约型还是即时型 · 提示可能缺的关键信息。<br><br>不会帮你做的：定价、定时间、定地点、留联系方式。</p>
    </div>`
};

function fillEx(i) {
  const ex = [
    '明天上午想找个人一起逛大英博物馆，中文交流，女生优先，逛完可以一起吃个午饭',
    '刚落地国王十字，现在急着买张能打电话的实体卡，哪里有',
    '9 月 13 号想找个地陪带我们两个人玩一天，最好会拍照，预算 80 镑左右',
    '想找个异性小姐姐一起在伦敦玩几天，长期关系也可以'
  ][i];
  el('pubText').value = ex;
  S.exIdx = i;
}

function doParse() {
  const v = (el('pubText') || {}).value || '';
  if (!v.trim()) return toast('先说一句话吧');
  if (S.exIdx === 3 || /异性|长期关系|颜值|有偿陪伴/.test(v)) {
    return modal(`
      <h4 style="color:#C33B36">这条需求无法发布</h4>
      <p style="font-size:13px;color:#4E5C6E;line-height:1.8">它归不进 8 个品类里的任何一个，且命中了「擦边交友」的语义规则。</p>
      <p style="font-size:12.5px;color:#7E8B9B;line-height:1.8;margin-top:10px">喊呗解决的是「办事」，不是「处对象」。品类白名单里没有交友、同城、聊天选项，性别偏好只能用于「仅同性响应」这一个安全用途。</p>
      <button class="s-btn ghost sm" style="margin-top:14px" onclick="closeModal()">我改一下</button>`);
  }
  screenBox.innerHTML = `<div class="s-pad"><div class="thinking"><i></i>小螺正在整理你的需求…</div>
    <p class="s-hint">调用 <code>aiGateway</code> → 能力 <code>parseRequest</code> → 额度检查 → 缓存 → 组 Prompt → 调模型 → Schema 校验</p></div>`;
  setTimeout(() => { S.parsed = true; renderScreen(); }, 1100);
}


SCREENS.home = {
  title: '喊呗', tab: 'home', chip: '首页 · 需求广场',
  notes: [
    ['key', '从「内容推荐流」改成「需求流」', 'V1.0 的首页是帖子推荐流，用户刷完不知道该做什么。V2.0 首屏陈列的全是<b>还有效的事</b>——每张卡片都带时效倒计时，过期即自动下架。'],
    ['', '卡片信息就是响应决策所需的全部', '品类、时效、地点范围、报酬、发布者信任徽章、已有多少人响应。让响应者在列表页就能判断值不值得点进去，避免无效投入。'],
    ['', '地点只到街区级', '不允许精确到门牌，系统对疑似详细地址做提示拦截。这是安全设计，不是数据缺失。'],
    ['warn', '不显示 DAU / 发帖量', '这两个指标能靠「看内容」刷出来，与撮合成功无因果关系。产品内外都只看每周成功撮合数与首响率。']
  ],
  render: () => `
    <div class="s-pad">
      <div class="s-city">
        <span class="cty">伦敦 ▾ <small>自动定位 + 手动选择，逻辑以手动为准</small></span>
      </div>
      <div class="s-filters">
        <span class="on">全部</span><span>搭子同行</span><span>付费地陪</span><span>打听咨询</span>
        <span>借物易物</span><span>住宿</span><span>代购跑腿</span><span>翻译陪同</span><span>应急求助</span>
      </div>
      <div class="s-banner">🐚 <span><b>小螺</b>已把 3 条今天到期的需求推给了 23 位本地响应者</span></div>
      ${REQS.map(reqCard).join('')}
      <p class="s-hint" style="text-align:center;margin-top:14px">已到底 · 过期需求单已自动归档进城市知识库</p>
    </div>`
};

function parsedView() {
  return `
    <div class="s-pad">
      <div class="parsed">
        <div class="parsed-h">🐚 <b>我理解成这样，对吗？</b>每一项都可以点开改</div>
        <div class="f-row"><span class="k">品类</span><span class="v">搭子同行</span><span class="ed">修改</span></div>
        <div class="f-row"><span class="k">城市</span><span class="v">伦敦</span><span class="ed">修改</span></div>
        <div class="f-row"><span class="k">标题</span><span class="v">找人一起逛大英博物馆</span><span class="ed">修改</span></div>
        <div class="f-row"><span class="k">时效</span><span class="v">预约型</span><span class="ed">修改</span></div>
        <div class="f-row"><span class="k">人数</span><span class="v">1 人</span><span class="ed">修改</span></div>
        <div class="f-row"><span class="k">报酬</span><span class="v">免费互助</span><span class="ed">修改</span></div>
        <div class="f-row"><span class="k">偏好</span><span class="v">中文 · 仅同性响应</span><span class="ed">修改</span></div>
        <div class="f-row blank"><span class="k">期望时间</span><span class="v">请你自己确认</span><span class="ed">填写</span></div>
        <div class="f-row blank"><span class="k">见面地点</span><span class="v">请你自己确认（街区级）</span><span class="ed">填写</span></div>
        <div class="f-row blank"><span class="k">参考金额</span><span class="v">免费单无需填写</span><span class="ed">—</span></div>
        <div class="parsed-f">⚠️ 时间、地点、金额、联系方式四类字段小螺一律不代填。这些是对现实世界的承诺，必须由你确认。</div>
      </div>
      <div class="reach">📣 <span>发出后将推送给伦敦 <b>23 位</b>可能帮上你的人 · 并进入「找搭子」官方分区</span></div>
      <p class="s-hint" style="margin:12px 0">你的信任分 62，属于「机审通过即可见」档位，无需等人工复核。</p>
      <button class="s-btn" onclick="doPublish()">发布</button>
      <button class="s-btn ghost sm" style="margin-top:9px" onclick="S.parsed=false;renderScreen()">重新说一次</button>
    </div>`;
}

function doPublish() {
  toast('已发布 · 机审通过（毫秒级），已开始分发');
  S.parsed = false;
  setTimeout(() => go('detail'), 700);
}

SCREENS.detail = {
  title: '需求单详情', tab: 'home', back: 'home', chip: '需求单详情 · 响应与选定',
  notes: [
    ['key', '响应列表 = 昵称 + 徽章 + 证据摘要 + 报价 + 自荐 + AI 推荐理由', '默认按「信任分 + 响应速度」综合排序，可切按报价。<b>不显示裸分数</b>，只显示四档徽章加可展开的证据清单——让用户看到「他凭什么可信」，而不是一个不可解释的数字。'],
    ['', 'AI 推荐理由必须可追溯', '名单由代码排序，理由由模型写，但理由里的每个数字都必须能追溯回依据字段，否则换成模板拼接。不允许「猜你喜欢」式无理由推荐。'],
    ['warn', '选定后才互相下发联系方式', '全站只有这一个下发点。广场、列表、卡片一律不含联系方式——挂在需求单上等于向全城公开个人账号。'],
    ['', '选定可撤销，但要说实话', '可以退回「待选定」重新挑人，原有响应全部保留；<b>但已交换的联系方式收不回</b>，确认弹窗必须明示这一点。'],
    ['key', '取消与撤销不重罚', '都会留痕作为风控信号，但信任分主要看双方真实互评。按次数扣分是在惩罚正常行为，还会诱导用户把单子挂到过期——那更坏。']
  ],
  render: () => S.picked ? matchedView() : `
    <div class="det-h">
      <div class="rq-top">
        <span class="cat">搭子同行</span><span class="timer plan">预约型 · 9/12 10:00</span><span class="badge b3">仅同性响应</span>
      </div>
      <h3>9/12 上午想找人一起逛大英博物馆</h3>
      <p class="s-hint">中文交流，女生优先。逛完可以一起吃个午饭，费用各付。</p>
      <div class="det-grid">
        <div><span class="k">地点范围</span><span class="v">大英博物馆 / 罗素广场一带</span></div>
        <div><span class="k">报酬</span><span class="v">免费互助</span></div>
        <div><span class="k">人数</span><span class="v">1 人</span></div>
        <div><span class="k">可见范围</span><span class="v">伦敦社区公开</span></div>
      </div>
      <div class="rq-foot">
        <span class="who-mini"><i class="av p">林</i>林悦<span class="badge b2">靠谱</span><span class="badge b1">已完成 4 单</span></span>
        <span class="s-hint">2 小时前发布</span>
      </div>
    </div>
    <div class="s-pad">
      <div class="s-t">已有 3 人响应<span>按信任分 + 响应速度排序 ▾</span></div>
      ${RESPONDERS.map((r, i) => `
        <div class="resp">
          <div class="resp-top">
            <i class="av ${r.av}">${r.name[0]}</i>
            <span class="nm"><b>${r.name} <span class="badge ${r.badge}">${r.badgeTx}</span></b><small>${r.quote}</small></span>
          </div>
          <p class="say">${r.say}</p>
          <div class="evi-line">${r.evi.map(e => `<span>· ${e}</span>`).join('')}</div>
          <div class="ai-reason"><b>🐚 为什么推荐他：</b>${r.reason}</div>
          <div class="pick">
            <button class="s-btn sm" onclick="askPick(${i})">选定 TA</button>
            <button class="s-btn ghost sm" onclick="toast('已私信 ${r.name}（M3 上线站内私信）')">先聊聊</button>
          </div>
        </div>`).join('')}
      <p class="s-hint" style="margin-top:10px">超时未选定将自动过期，需求单连同这些响应会归档进伦敦城市知识库，成为小螺的检索语料。</p>
    </div>`
};

function askPick(i) {
  const r = RESPONDERS[i];
  modal(`
    <h4>确认选定 ${r.name}？</h4>
    <ul>
      <li>选定后<b>双方互相看到联系方式</b></li>
      <li>系统会生成一张只读的<b>约定单</b>，双方均可见、不可单方修改</li>
      <li>约不上可以<b>撤销选定</b>重新挑人，撤销会被记录，<b>但已看到的联系方式收不回</b></li>
    </ul>
    <div class="warn-card"><b>见面安全提示（必读）</b>首次见面选公共场所 · 不提前转账 · 不交出证件 · 把行程告知朋友。平台不代收资金，任何要求先付押金的都属异常。</div>
    <div class="s-row">
      <button class="s-btn sm" onclick="confirmPick()">我已阅读，确认选定</button>
      <button class="s-btn ghost sm" onclick="closeModal()">再想想</button>
    </div>`);
}

function confirmPick() {
  closeModal(); S.picked = true; renderScreen();
  toast('已确定 · 约定单已生成，联系方式已双向下发');
}

function matchedView() {
  return `
    <div class="det-h">
      <div class="rq-top"><span class="cat">搭子同行</span><span class="badge b2">已确定</span></div>
      <h3>9/12 上午想找人一起逛大英博物馆</h3>
      <p class="s-hint">林悦 ↔ 陈默 · 双方都点击「已完成」后进入互评</p>
    </div>
    <div class="s-pad">
      <div class="ag">
        <div class="ag-h"><span>约定单 · 只读凭证</span><span>v1</span></div>
        <div class="f-row"><span class="k">谁</span><span class="v">林悦 ↔ 陈默</span></div>
        <div class="f-row"><span class="k">时间</span><span class="v">9 月 12 日 10:00</span></div>
        <div class="f-row"><span class="k">地点</span><span class="v">大英博物馆正门（街区级）</span></div>
        <div class="f-row"><span class="k">做什么</span><span class="v">陪同参观约 3 小时，中文讲解</span></div>
        <div class="f-row"><span class="k">报酬</span><span class="v">免费互助，午饭各付</span></div>
        <div class="f-row"><span class="k">如何支付</span><span class="v">平台不代收，无需支付</span></div>
        <div class="parsed-f">修改需双方重新确认并留版本记录。发生纠纷时，约定单 + 聊天记录 + 评价构成判定依据，处理结果是信任分与封禁，而非退款。</div>
      </div>
      <div class="contact">
        联系方式已双向下发（仅你与陈默可见）
        <b>微信：chenmo_ucl</b>
        清空只对之后新达成共识的人生效，已经看到的收不回。
      </div>
      <div class="s-row" style="margin-bottom:11px">
        <button class="s-btn sm" onclick="go('chat')">进入私信</button>
        <button class="s-btn ghost sm" onclick="toast('行程卡片已生成，可经微信分享给朋友 —— 平台不存储紧急联系人')">行程报备</button>
      </div>
      <button class="sos" onclick="modal('<h4>一键 SOS</h4><ul><li>英国紧急电话 <b>999</b></li><li>欧盟通用 112 · 美国 911</li><li>中国驻英使馆 +44 20 7299 4049</li><li>把当前行程卡片发给此前报备的联系人</li></ul><button class=\\'s-btn ghost sm\\' onclick=\\'closeModal()\\'>关闭</button>')">🆘 紧急求助</button>
      <div class="s-t">进行中</div>
      <button class="s-btn dark" onclick="go('review')">我已完成，去评价</button>
      <button class="s-btn ghost sm" style="margin-top:9px" onclick="S.picked=false;renderScreen();toast('已撤销选定，退回待选定 · 原有 3 条响应全部保留')">撤销选定，重新挑人</button>
      <p class="s-hint" style="margin-top:12px">撤销会被记录为风控信号，但不作为信任分的主要扣分项——改变主意本身合理。</p>
    </div>`;
}

SCREENS.assistant = {
  title: '小螺', tab: 'home', back: 'home', chip: '小螺助手 · 兜底作答',
  notes: [
    ['key', 'AI 是供给的兜底层，不是替代层', '最致命的流失点不是「匹配不精准」，而是「发了没人理，用户当天就走了」。真人响应永远优先展示，兜底答案只在无响应或用户主动询问时出现。'],
    ['', '兜底答案强制标注来源', '「根据伦敦小组 3 条历史回答，请自行核实」。答案只依据站内语料，不让模型自由发挥。'],
    ['warn', '签证 / 医疗 / 法律 / 移民在服务端前置拦截', '<b>不调模型、不占额度</b>，直接给官方链接和「请咨询专业机构」。这类问题答错的代价由用户承担，不是模型能力问题而是责任边界问题。'],
    ['', '有副作用的动作必须用户点确认', '意图识别与工具编排是纯函数规则表；建单、发邀请这类动作只能由用户点确认触发，AI 不会自己发出去。'],
    ['', '首屏声明「我是 AI」', '一切对外内容强制带「AI 协助」标识。追问上限 2 轮，之后降级为普通表单，禁止死循环。']
  ],
  render: () => `
    <div class="bub-wrap" id="bubs">
      <div class="bub ai"><span class="ai-tag">🐚 我是 AI 助手小螺</span>我可以帮你把想法整理成需求单、查伦敦本地的事、或者在没人响应时先给你一个能用的答案。<br><br>时间、地点、金额、联系方式我不会替你填。</div>
      ${S.chat.map(c => c.h).join('')}
    </div>
    <div class="q-chips">
      <button onclick="ask('sim')">机场怎么进市区最便宜？</button>
      <button onclick="ask('fallback')">我那条电话卡的单子没人理</button>
      <button onclick="ask('visa')">我这个签证能待多久？</button>
      <button onclick="ask('create')">帮我发个找搭子的单</button>
    </div>`
};

const ANSWERS = {
  sim: `<div class="bub me">从希思罗进市区，最便宜的方式是什么？</div>
    <div class="bub ai"><span class="ai-tag">🐚 AI 协助</span>最便宜是<b>地铁 Piccadilly 线</b>，约 £5.6（Oyster/刷卡），到市中心 50~60 分钟。<br>次选 Elizabeth Line 约 £12、25 分钟。Heathrow Express 最快 15 分钟但 £25 起。<br>深夜（0:30 后）没有地铁，只能夜班巴士 N9 或打车。
    <div class="src">来源：伦敦小组 3 条历史回答（2026-06 至 2026-08）+ 城市语料库「机场交通」条目。票价可能变动，请自行核实。</div></div>`,
  fallback: `<div class="bub me">我那条买电话卡的单子发出去 40 分钟了，没人理</div>
    <div class="bub ai"><span class="ai-tag">🐚 AI 协助 · 兜底作答</span>我先把答案给你，同时已经把这条单子改写文案二次投放了（第 1 / 2 次）。<br><br><b>国王十字站内</b>：WHSmith 有 EE / Vodafone 预付卡；<b>出站往 Euston Road</b> 走 3 分钟有 Three 门店，£10 起含流量。带护照，店员会帮你激活。
    <div class="src">来源：伦敦小组 5 条历史回答 + 3 张过期需求单的真人回复。请自行核实营业时间。</div></div>
    <div class="risk">🐚 这条兜底答案会被记入「采纳率」指标（达标线 ≥50%）。你点「有用」或不再追问都算采纳。</div>`,
  visa: `<div class="bub me">我这个签证类型能在英国待多久？</div>
    <div class="bub ai"><span class="ai-tag">🐚 服务端前置拦截</span>签证、医疗、法律、移民类问题我不回答——<b>这类问题答错的代价你承担不起</b>。<br><br>请查英国政府官方页面 gov.uk/check-uk-visa，或咨询持牌移民顾问（OISC 注册）。<br><br>这次提问不会调用模型，也不占用你的额度。</div>`,
  create: `<div class="bub me">帮我发个找搭子的单</div>
    <div class="bub ai"><span class="ai-tag">🐚 AI 协助</span>好，我需要知道：<b>哪天、想去哪、几个人</b>。<br><br>说完我整理成需求单给你确认——<b>建单这个动作要你点确认才会真的发出去</b>，我不会自己发。</div>`
};

function ask(k) {
  S.chat.push({ h: ANSWERS[k] });
  renderScreen();
  const b = el('bubs'); if (b) b.parentElement.scrollTop = b.scrollHeight;
}

SCREENS.city = {
  title: '城市', tab: 'city', chip: '城市社区 · 供给容器',
  notes: [
    ['key', '城市是唯一的一级容器', 'V1.0 首页与「组圈」职责重叠，两个 Tab 做同一件事。V2.0 首页 = 需求广场，城市 Tab = 社区与<b>供给池</b>：当地先有人入驻，才有能力承接需求。'],
    ['', '官方 5 分区与需求单品类对齐', '找搭子、问本地、跑腿代购、闲置转让、住宿。兴趣小组受健康度与数量上限约束——建组上限 = 城市周活跃用户数 ÷ 20，伦敦初期就是 0~2 个。<b>这是有意的克制</b>，冷启动期不允许提前碎片化。'],
    ['', '热搜榜改成「本周大家在问什么」', '由真实需求单聚合而来。V1.0 的热搜榜在冷启动期只会暴露冷清。'],
    ['key', '内容降级为供给端入驻理由 + AI 语料', '内容仍然重要，但职责从「主线」变成两件事：给本地人一个来的理由，给小螺一个知识来源。'],
    ['', '渠道用学校，结构用城市', '旅行者只知道城市不知道学校，所以容器必须是城市；但留学生天然按学校组织，所以 BD 按 UCL / KCL / IC / LSE 推进。这两件事不矛盾。']
  ],
  render: () => `
    <div class="s-pad">
      <div class="s-city"><span class="cty">伦敦 ▾ <small>周活跃 412 人 · 认证响应者 68 人</small></span></div>
      <div class="zones">
        <div><i>🧑‍🤝‍🧑</i>找搭子</div><div><i>💬</i>问本地</div><div><i>🛍️</i>跑腿代购</div><div><i>♻️</i>闲置转让</div><div><i>🛏️</i>住宿</div>
      </div>
      <div class="s-t">本地响应者名录<span>按信任分排序 ▾</span></div>
      <div class="people">
        <div class="pc"><i class="av t">陈</i><b>陈默</b><small>UCL · 带路/拍照<br>12 单 · 好评 100%</small><span class="badge b2">靠谱</span></div>
        <div class="pc"><i class="av p">苏</i><b>苏眠</b><small>KCL · 翻译/陪同<br>31 单 · 好评 97%</small><span class="badge b3">老手</span></div>
        <div class="pc"><i class="av">李</i><b>李维</b><small>IC · 代购/跑腿<br>58 单 · 好评 99%</small><span class="badge b4">城市之光</span></div>
        <div class="pc"><i class="av t">王</i><b>王甜</b><small>LSE · 带路<br>3 单 · 好评 100%</small><span class="badge b2">靠谱</span></div>
      </div>
      <div class="s-t">本周伦敦大家在问什么<span>由真实需求单聚合</span></div>
      <ul class="hot">
        <li><em>1</em>哪里买电话卡最划算<span>23 次</span></li>
        <li><em>2</em>希思罗进市区怎么走<span>18 次</span></li>
        <li><em>3</em>周末找人一起逛博物馆<span>15 次</span></li>
        <li><em>4</em>看病 / GP 注册流程<span>11 次</span></li>
        <li><em>5</em>退税怎么办<span>9 次</span></li>
      </ul>
      <div class="s-t">兴趣小组<span>当前可新建 2 个</span></div>
      <div class="s-card">
        <div class="queue-t"><span>伦敦摄影搭子</span><em>健康分 72</em></div>
        <p>周活跃 14 人 · 产生需求单 6 条 · 首响率 67%</p>
        <div class="bar"><i style="width:72%"></i></div>
      </div>
      <div class="s-card">
        <div class="queue-t"><span>伦敦租房互助</span><em style="background:#FFF4E0;color:#B08A2E">健康分 41 · 已降权</em></div>
        <p>连续 3 周低于 30 将进入沉寂：停止新成员进入、内容合并回官方分区、小组归档。小螺可代写话题帮组长救活。</p>
        <div class="bar"><i style="width:41%"></i></div>
      </div>
      <div class="s-t">开城标准（伦敦跑通后才复制下一城）</div>
      <div class="kpi">
        <div><b>68</b><small>认证响应者 · 目标 ≥50</small><span class="up">✓ 达标</span></div>
        <div><b>34</b><small>周需求单 · 目标 ≥30</small><span class="up">✓ 达标</span></div>
        <div><b>58%</b><small>首响率 · 目标 ≥60%</small><span class="down">未达标</span></div>
        <div><b>44%</b><small>次月留存 · 目标 ≥40%</small><span class="up">✓ 达标</span></div>
      </div>
      <p class="s-hint">四项必须同时达标。撮合是密度游戏，3 城试点等于把密度除以 3。</p>
    </div>`
};

SCREENS.mine = {
  title: '我的', tab: 'mine', chip: '我的 · 自主性阶梯',
  notes: [
    ['key', '自主性阶梯放在用户手里', '这是本产品 AI 设计的核心主张。全自动有风险、纯手动没价值，正确答案不是取折中点，而是把自主性<b>产品化为可解释、可调节、可回退的档位</b>，默认保守，由用户自行上调。'],
    ['warn', 'L3 永不实现，并把理由展示给用户', '点一下 L3 看看会发生什么。写清「不做什么」和写清「做什么」同样重要。'],
    ['', 'L0 与 L1 的差别是行为差别', '不是标签差别——L1 能发邀请，L0 不能。档位落到服务端校验，不是前端提示。'],
    ['', '订单入口落地为「我发布的 / 我响应的」', 'V1.0 的「我的订单」只是一个预留入口。现在它是有状态分组的真实列表：招募中 / 待选定 / 进行中 / 已完成 / 已过期。'],
    ['key', '联系方式在这里自填，且可随时清空', '发布需求时不需要、也不允许挂在需求单上。清空只对之后新达成共识的人生效，已经看到的收不回——界面如实说明。']
  ],
  render: () => `
    <div class="mine-head">
      <div class="mine-top">
        <i class="av lg p">林</i>
        <span class="nm"><b>林悦 <span class="badge b2">靠谱</span></b><small>需求方 · 上海 → 伦敦 · 停留 9/8–9/15</small></span>
        <span class="trust-ring"><b>62</b><small>信任分（内部）</small></span>
      </div>
      <div class="mine-stats">
        <div><b>4</b><small>已完成</small></div><div><b>100%</b><small>好评率</small></div>
        <div><b>2</b><small>在架 / 上限 3</small></div><div><b>0</b><small>被举报</small></div>
      </div>
    </div>
    <div class="s-pad">
      <div class="s-t">小螺的自主性<span>随时可回退，立即生效</span></div>
      <div class="lad">
        ${['L0', 'L1', 'L2'].map(l => `<button class="${S.lad === l ? 'on' : ''}" onclick="setLad('${l}')"><b>${l}</b>${{ L0: '只读建议', L1: '一键代发', L2: '自动分发' }[l]}</button>`).join('')}
        <button onclick="whyNoL3()"><b>L3</b>自动协商</button>
      </div>
      <p class="s-hint">${{ L0: '小螺只解析、只建议，不对外发送任何内容。新用户前 3 单默认在这一档。', L1: '小螺生成邀请文案和候选人名单，<b>等你勾选后统一发出</b>。这是全局默认档。', L2: '需求单发布后自动向匹配响应者推送结构化需求卡片；2 小时无响应自动改写文案二次投放（≤2 次）。不进私信、不模拟真人语气。' }[S.lad]}</p>
      <div class="s-t">我的需求单</div>
      <div class="menu">
        <a onclick="go('detail')">📣 我发布的 <span class="tagm">2 招募中 · 1 已确定</span><span class="ar">›</span></a>
        <a onclick="toast('我响应的：1 条已确定，3 条待选定')">✋ 我响应的 <span class="ar">›</span></a>
        <a onclick="go('review')">⭐ 待我评价 <span class="tagm">1</span><span class="ar">›</span></a>
      </div>
      <div class="s-t">信任与安全</div>
      <div class="menu">
        <a onclick="go('trust')">🛡️ 信任档案与增信任务 <span class="tagm">+18 分可拿</span><span class="ar">›</span></a>
        <a onclick="toast('联系方式：微信 linyue_0912 · 可随时清空，已看到的收不回')">📇 我的联系方式 <span class="ar">›</span></a>
        <a onclick="toast('仅同性响应默认关闭，女性用户首次发单时会主动提示')">👥 安全开关 <span class="ar">›</span></a>
        <a onclick="toast('已拉黑 0 人 · 拉黑后互相不可见需求单、不可响应、不可私信')">🚫 黑名单 <span class="ar">›</span></a>
      </div>
      <div class="s-t">其他</div>
      <div class="menu">
        <a onclick="toast('会员：更快被响应、更容易被选中 · ¥18/月（阶段 1 才上线）')">💎 会员 <span class="tagm">阶段 1</span><span class="ar">›</span></a>
        <a onclick="go('admin')">📊 运营后台（管理员可见） <span class="ar">›</span></a>
        <a onclick="toast('隐私政策 / 用户协议 / 社区规范 —— UGC 基础四件套之三')">📄 协议与社区规范 <span class="ar">›</span></a>
        <a onclick="toast('账号与数据删除入口 —— GDPR 要求，独立可访问')">🗑️ 删除我的数据 <span class="ar">›</span></a>
      </div>
    </div>`
};

function setLad(l) {
  S.lad = l; renderScreen();
  toast(l === 'L2' ? 'L2 已开启 · 对外触达只会是系统卡片，强制带「由小螺代为分发」标识' : l + ' 已生效');
}

function whyNoL3() {
  modal(`
    <h4 style="color:#C33B36">L3 自动协商：本产品永不实现</h4>
    <ul>
      <li><b>责任无法归属</b>——AI 谈定的见面时间地点若发生人身安全事件，责任链条不清</li>
      <li><b>AI 承诺会造成真实损失</b>——谈价、谈时间是对现实世界的承诺，模型出错的代价由你承担</li>
      <li><b>伦理与合规</b>——AI 以真人语气与人协商却不明示身份，在多数地区已属需要披露的行为</li>
      <li><b>能力边界诚实</b>——个人开发者无力承担由此产生的纠纷处理与客服成本</li>
    </ul>
    <p style="font-size:12.5px;color:#7E8B9B">把「不做」的理由摆在用户面前，比留一个灰掉的开关更可信。</p>
    <button class="s-btn ghost sm" style="margin-top:13px" onclick="closeModal()">明白了</button>`);
}

SCREENS.message = {
  title: '消息', tab: 'message', chip: '消息 · 状态通知',
  notes: [
    ['key', '新增「需求单状态通知」类型', 'V1.0 只有互动通知。需求单的每一次状态变更（被响应、被选定、即将过期、对方确认完成、待评价）都要有触达，否则撮合会断在「用户不知道发生了什么」。'],
    ['warn', '订阅消息：一次授权对应一条推送', '这是微信的硬约束，不是设计选择。因此产品必须在「发布需求单」「收到响应」这些时刻<b>顺势请求授权</b>——L2 自动分发的触达率上限受授权率约束。'],
    ['', '响应者的打扰被严格控制', '同一响应者每日被 Agent 触达 ≤3 次，被静默或拒绝 2 次后进 7 天冷却。产品对两侧的容忍度<b>故意不对称</b>：需求方门槛要极低，响应者的打扰要严格控制——他们被无效需求打扰两三次就会永久关闭通知。']
  ],
  render: () => `
    <div>
      <div class="notif" onclick="go('chat')">
        <span class="ic o">🐚</span>
        <span class="tx"><b>小螺 <span class="badge ai">AI</span></b><p>你那条电话卡的需求还没人响应，我先给了你一个答案</p></span>
        <span class="tm">2 分钟前<br><span class="unread"></span></span>
      </div>
      <div class="notif" onclick="go('detail')">
        <span class="ic g">✅</span>
        <span class="tx"><b>陈默 接受了你的选定 <span class="unread"></span></b><p>约定单已生成，联系方式已双向下发</p></span>
        <span class="tm">14 分钟前</span>
      </div>
      <div class="notif" onclick="go('detail')">
        <span class="ic b">👀</span>
        <span class="tx"><b>3 人响应了你的需求单</b><p>9/12 上午想找人一起逛大英博物馆</p></span>
        <span class="tm">1 小时前</span>
      </div>
      <div class="notif" onclick="go('chat')">
        <span class="ic p">💬</span>
        <span class="tx"><b>陈默</b><p>那我们 9:50 在正门左边的台阶等？</p></span>
        <span class="tm">昨天</span>
      </div>
      <div class="notif">
        <span class="ic o">⏳</span>
        <span class="tx"><b>需求单即将过期</b><p>「今晚拼车去希思罗 T5」还有 40 分钟到期，要不要让小螺改写文案再投一次？</p></span>
        <span class="tm">昨天</span>
      </div>
      <div class="notif" onclick="go('review')">
        <span class="ic g">⭐</span>
        <span class="tx"><b>待评价</b><p>与苏眠的「借转换插头」已完成，7 天内未评视为默认好评但不计入好评率</p></span>
        <span class="tm">2 天前</span>
      </div>
      <div class="s-pad"><p class="s-hint">私信为云数据库轮询 + 实时数据推送实现，秒级即可，<b>不自建 WebSocket</b>——运维成本换不来对应的体验收益。</p></div>
    </div>`
};

SCREENS.chat = {
  title: '陈默', tab: 'message', back: 'message', chip: '私信 · 反诈提示',
  notes: [
    ['warn', '反诈提示同时提示双方', '出现「先转账」「押金」「发身份证照片」「加微信私下聊」「退出平台交易」等模式时向<b>双方</b>弹提示，而不是只警告一方——只提示一方会误伤正常沟通，也会让被提示者觉得平台在怀疑他。'],
    ['', '平台不代收资金，所以「先付押金」一定异常', '这条规则能成立，恰恰是因为产品明确不碰资金。任何要求线上先付的行为都不属于正常流程。'],
    ['key', '私信是唯一的协商场所，AI 不进来', 'L2 自动分发只能发系统需求卡片，不进 1v1 私信、不模拟真人语气、不代答追问。L3 自动协商永不实现——AI 谈定的见面时间地点若出事，责任链条不清。']
  ],
  render: () => `
    <div class="bub-wrap">
      <div class="bub you">你好，我看到你选定我了 🙌</div>
      <div class="bub me">是的！9/12 上午 10 点在博物馆正门可以吗</div>
      <div class="bub you">可以。我建议 9:50 到，10 点开门会排队</div>
      <div class="bub me">好，那就这样定了</div>
      <div class="bub you">对了，能不能先转 20 镑押金？我这边要提前订讲解耳机</div>
      <div class="risk">⚠️ <b>风险提示（双方均可见）</b><br>喊呗<b>不代收任何资金</b>，也不存在需要平台外先付押金的流程。请勿在见面前转账、勿提供证件照片。如对方坚持，请举报——「诈骗」类举报会优先处理。</div>
      <div class="bub me">平台提示了，我们见面再结算吧</div>
      <div class="bub you">抱歉，是我不了解规则，见面再说 👌</div>
      <div class="s-pad" style="padding-top:4px">
        <div class="s-row">
          <button class="s-btn ghost sm" onclick="toast('已复制英文破冰话术（translate 能力）')">🐚 帮我翻译</button>
          <button class="s-btn ghost sm" onclick="toast('已提交「诈骗」类举报 · 处理优先级仅次于人身安全')">举报</button>
        </div>
      </div>
    </div>`
};

SCREENS.trust = {
  title: '信任档案', tab: 'mine', back: 'mine', chip: '信任档案 · 四层信任',
  notes: [
    ['key', '不显示裸分数，显示证据清单', '分数不可解释会同时打击被评者的积极性和求助者的信心。对外只有四档徽章 + 「已完成 12 单｜好评率 100%｜平均 18 分钟响应｜UCL 邮箱已验证」这样的证据。'],
    ['warn', '完全不采集证件影像', '护照、签证、学生证属身份证件类敏感个人信息，GDPR 下处理它需要合规能力，个人开发者不具备——一次泄露的后果远大于产品收益。四层信任全部零资质门槛。'],
    ['', '不采集手机号', '微信手机号快速验证接口对个人主体不开放；云函数拿到的 openid 本身就是微信校验过的可信身份，手机号不额外提供可信度。去掉它同时符合数据最小化。'],
    ['key', '用收益框架而不是恐惧框架', '文案是「补全后被选中的概率高 2.6 倍」，不是「为了安全请认证」——后者在暗示危险。让增信的动机来自竞争而非恐惧。'],
    ['', '强制校验只在三处发生', '接付费地陪 / 翻译类单、发或接住宿类单、首次发起线下见面确认。其余全程不拦，注册零门槛。']
  ],
  render: () => `
    <div class="s-pad">
      <div class="s-card" style="text-align:center">
        <span class="badge b2" style="font-size:13px;padding:5px 14px">靠谱</span>
        <p class="s-hint" style="margin-top:10px">四档徽章：新面孔 → <b>靠谱</b> → 老手 → 城市之光</p>
      </div>
      <div class="s-t">你凭什么可信<span>对外展示的证据清单</span></div>
      <div class="evi">
        <div><span class="ok">✓</span>已完成 4 单</div>
        <div><span class="ok">✓</span>好评率 100%（4 / 4）</div>
        <div><span class="ok">✓</span>平均响应时长 23 分钟</div>
        <div><span class="ok">✓</span>被举报 0 次</div>
        <div><span class="ok">✓</span>微信授权登录 · 常驻城市已填</div>
      </div>
      <div class="s-t">增信任务<span>补全后被选中的概率高 2.6 倍</span></div>
      <div class="evi">
        <div><span>📧</span>学校邮箱验证<span class="todo">+8 分 · 只存「已验证 + 学校名」</span></div>
        <div><span>🔗</span>社媒绑定<span class="todo">+6 分 · 只存 URL 与校验时间</span></div>
        <div><span>📝</span>自我介绍完整度<span class="todo">+4 分</span></div>
      </div>
      <p class="s-hint" style="margin-top:10px">社媒绑定的做法：你提交小红书 / Instagram 主页链接，平台给一串一次性口令，你临时加进个人简介，平台校验后<b>只存「已绑定 + 主页 URL + 校验时间」</b>，不抓取、不存储对方平台内容，可随时解绑。</p>
      <div class="s-t">四层信任的构成</div>
      <div class="evi">
        <div><b style="color:#C4562F">L1</b>基础身份 · 微信登录 + 城市 + 性别自填<span class="todo">10 分</span></div>
        <div><b style="color:#C4562F">L2</b>自证 · 邮箱 / 社媒 / 介绍<span class="todo">≤20 分</span></div>
        <div><b style="color:#C4562F">L3</b>履约 · <b>主要看双方真实互评</b><span class="todo">≤60 分</span></div>
        <div><b style="color:#C4562F">L4</b>社区背书 · 组长或老用户背书<span class="todo">≤10 分</span></div>
      </div>
      <p class="s-hint" style="margin-top:10px">性别字段的用途只有一个：支撑「仅同性响应」开关。自填、可留空、不校验，除此之外不参与任何排序、推荐或筛选，<b>也不提供任何异性偏好选项</b>。</p>
    </div>`
};

SCREENS.review = {
  title: '双向评价', tab: 'home', back: 'detail', chip: '双向评价 · 闭环',
  notes: [
    ['key', '互评前互不可见', '避免报复性打分与互相试探。7 天内未评视为默认好评，<b>但不计入好评率</b>——沉默不该被当成赞美。'],
    ['', '互评是信任分的主要输入', 'L3 履约 60 分里，主要输入是双方交易后的真实互评，其次是真实完成单数。取消率、撤销次数只作为风控信号参与小幅调整。'],
    ['key', '评价会被聚合成信任标签', '<code>summarizeReviews</code> 把散落的文字评价聚合成个人主页上的标签（如「讲解清楚」「守时」），让证据清单更易读。'],
    ['', '完成 → 评价 → 复用', '完成率目标 ≥70%，评价率 ≥60%，30 天内二次发单率 ≥20%。评价率低意味着闭环没跑完，信任分就长不起来。']
  ],
  render: () => `
    <div class="s-pad">
      <div class="s-card" style="text-align:center">
        <i class="av lg t" style="margin:0 auto 9px">陈</i>
        <b>和陈默的这次「逛大英博物馆」怎么样？</b>
        <div class="stars">${[1, 2, 3, 4, 5].map(i => `<span class="${S.stars >= i ? 'on' : ''}" onclick="setStars(${i})">★</span>`).join('')}</div>
        <p class="s-hint">${S.stars ? ['', '很不满意', '不太满意', '一般', '满意', '非常满意'][S.stars] : '点星星打分'}</p>
      </div>
      <div class="s-t">加几个标签（可多选）</div>
      <div class="tagpick">
        ${['守时', '讲解清楚', '沟通顺畅', '很热情', '路线熟', '会拍照', '有耐心'].map(t => `<button class="${S.tags.includes(t) ? 'on' : ''}" onclick="tapTag('${t}')">${t}</button>`).join('')}
      </div>
      <textarea class="s-input" rows="3" placeholder="说点具体的，会帮到下一个人（选填）"></textarea>
      <button class="s-btn" style="margin-top:12px" onclick="submitReview()">提交评价</button>
      <p class="s-hint" style="margin-top:12px">你的评价在对方也评完之后才会互相可见。评价会更新对方的履约分与信任标签。</p>
    </div>`
};

function setStars(n) { S.stars = n; renderScreen(); }
function tapTag(t) {
  S.tags.includes(t) ? S.tags.splice(S.tags.indexOf(t), 1) : S.tags.push(t);
  renderScreen();
}
function submitReview() {
  if (!S.stars) return toast('先打个分吧');
  toast('已提交 · 对方评完后互相可见，履约分已排队更新');
  S.stars = 0; S.tags = []; S.picked = false;
  setTimeout(() => go('mine'), 900);
}

SCREENS.admin = {
  title: '运营后台', tab: 'mine', back: 'mine', chip: '运营后台 · 四件事',
  notes: [
    ['key', '后台就是小程序里的管理员页面', 'openid 白名单 + 云函数二次校验管理员身份，<b>不做独立 Web 后台</b>。只做四件事：待审队列、举报队列、用户管理、数据看板。个人开发者的运维带宽只够这么多。'],
    ['', '人工复核目标 <20 分钟/天', '机审毫秒级由 AI 承担，人工只处理机审转来的部分，配合「待审队列 + 一键通过/驳回模板」。这个数字决定了分级审核的策略能不能长期跑下去。'],
    ['warn', '看板上没有 DAU', '只有每周成功撮合数、首响率、响应者留存，加上 AI 效果四项。看板放什么，就等于团队每天关心什么。'],
    ['', 'AI 效果看板是可展示材料', '字段抽取准确率、字段修改率、兜底采纳率、单次撮合 AI 成本——AI 功能必须可度量，否则无法判断该不该继续投入。']
  ],
  render: () => `
    <div class="s-pad">
      <div class="s-t">本周伦敦<span>2026-08-29 → 09-04</span></div>
      <div class="kpi">
        <div><b>11</b><small>成功撮合数（北极星）</small><span class="up">↑ 3</span></div>
        <div><b>58%</b><small>首响率 · 目标 ≥60%</small><span class="down">↓ 4pt</span></div>
        <div><b>44%</b><small>响应者次月留存</small><span class="up">✓ 达标</span></div>
        <div><b>34</b><small>本周需求单</small><span class="up">↑ 6</span></div>
      </div>
      <div class="s-t">AI 效果</div>
      <div class="kpi">
        <div><b>89.2%</b><small>字段抽取准确率 · 线 85%</small><span class="up">✓</span></div>
        <div><b>0</b><small>四类字段误填（红线）</small><span class="up">✓</span></div>
        <div><b>61%</b><small>兜底采纳率 · 线 50%</small><span class="up">✓</span></div>
        <div><b>¥0.04</b><small>单次撮合 AI 成本 · 线 0.10</small><span class="up">✓</span></div>
      </div>
      <div class="s-t">待审队列<span>目标 30 分钟内处理</span></div>
      <div class="queue">
        <div class="queue-t"><span>新用户前 3 条内容</span><em>4 条待审</em></div>
        <p>机审已通过，等人工复核。信任分 ≥30 且无违规的用户走「先发后审」，不进这个队列。</p>
      </div>
      <div class="queue">
        <div class="queue-t"><span>敏感品类抽检</span><em>2 条</em></div>
        <p>住宿、应急求助、含金额的付费单一律机审 + 人工抽检。</p>
      </div>
      <div class="s-t">举报队列<span>人身安全类置顶</span></div>
      <div class="queue">
        <div class="queue-t"><span>擦边交友</span><em style="background:#FDE8E8;color:#C33B36">1 条 · 高优</em></div>
        <p>处理优先级仅次于人身安全。擦边类违规跳过提示，直接禁止接单 7 天，二次永久封禁。</p>
      </div>
      <div class="queue">
        <div class="queue-t"><span>未履约</span><em>3 条</em></div>
        <p>判定依据：约定单 + 聊天记录 + 评价。处理结果是信任分与封禁，不涉及退款——平台不碰资金。</p>
      </div>
      <div class="s-row" style="margin-top:6px">
        <button class="s-btn sm" onclick="toast('已通过 · 审计日志与状态同生共死')">一键通过</button>
        <button class="s-btn ghost sm" onclick="toast('已驳回并发送可修改提示模板')">驳回</button>
      </div>
    </div>`
};

/* ---------------- 运行时 ---------------- */
const ORDER = ['home', 'detail', 'publish', 'assistant', 'city', 'message', 'chat', 'mine', 'trust', 'review', 'admin'];
const TABS = [
  ['home', '🏠', '首页'], ['city', '🏙', '城市'], ['publish', '喊', '喊一声'],
  ['message', '💬', '消息'], ['mine', '👤', '我的']
];

function go(id) {
  if (!SCREENS[id]) return;
  closeModal();
  S.screen = id;
  renderScreen();
  screenBox.scrollTop = 0;
  const box = el('prototype');
  if (box && window.scrollY < box.offsetTop - 120) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderChips() {
  el('chips').innerHTML = ORDER.map(id =>
    `<button class="chip ${S.screen === id ? 'on' : ''}" onclick="go('${id}')">${SCREENS[id].chip}</button>`
  ).join('');
}

function renderTabs() {
  const cur = SCREENS[S.screen].tab;
  el('tabbar').innerHTML = TABS.map(([id, ic, tx]) =>
    `<button class="${cur === id ? 'on' : ''} ${id === 'publish' ? 'mid' : ''}" onclick="go('${id}')"><i>${ic}</i>${tx}</button>`
  ).join('');
}

function renderNotes() {
  const s = SCREENS[S.screen];
  el('notes').innerHTML = `
    <h3>${s.chip}</h3>
    <p class="n-sub">这一屏为什么这么设计</p>
    ${s.notes.map(([k, t, b]) => `<div class="note ${k}"><b>${t}</b><p>${b}</p></div>`).join('')}
    <p class="note-tip">旁注来自产品的 PRD 与决策记录，不是事后补写的说明。每条设计都能追溯到 V1.0 复盘里的某个具体问题。</p>`;
}

function renderScreen() {
  const s = SCREENS[S.screen];
  el('phoneTitle').textContent = s.title;
  const back = el('phoneBack');
  back.className = 'phone-back' + (s.back ? ' show' : '');
  back.onclick = () => go(s.back);
  screenBox.innerHTML = s.render();
  renderChips();
  renderTabs();
  renderNotes();
}

/* 悬浮球：小螺入口不占底部 Tab */
(function mountFab() {
  const fab = document.createElement('button');
  fab.textContent = '🐚';
  fab.title = '小螺';
  fab.style.cssText = 'position:absolute;right:14px;bottom:88px;width:48px;height:48px;border-radius:50%;border:0;' +
    'background:linear-gradient(135deg,#FF7A59,#FFC24D);font-size:22px;cursor:pointer;z-index:15;' +
    'box-shadow:0 10px 24px -8px rgba(255,122,89,.85)';
  fab.onclick = () => go('assistant');
  document.querySelector('.phone').appendChild(fab);
})();

renderScreen();









