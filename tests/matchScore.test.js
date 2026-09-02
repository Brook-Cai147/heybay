/**
 * M2-11 匹配打分与推荐理由校验单测（D-20：分发匹配属必须有单测的一类）。
 *
 * 三类错都不会报错，只会让推荐悄悄变差或越线：
 *   权重失效     → 排序看起来还挺合理，其实和依据没关系
 *   性别过滤失效 → 「仅同性响应」这个安全开关形同虚设（D-26）
 *   理由校验失效 → 模型编一个"做过 8 次代购"，用户照着信（PRD 5.4 可解释性红线）
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  WEIGHTS,
  DONE_COUNT_CAP,
  RECENT_ACTIVE_DAYS,
  SKIP_REASON,
  scoreCandidate,
  rejectReason,
  selectCandidates,
  verifyReason,
  templateReason
} = require('../cloudfunctions/_shared/ai/matchScore')
const {
  GENDER,
  PREFERENCE_FLAG,
  REQUEST_CATEGORY
} = require('../cloudfunctions/_shared/constants/enums')

const NOW = new Date('2026-09-02T12:00:00Z').getTime()
const DAY = 24 * 60 * 60 * 1000

const request = (overrides = {}) =>
  Object.assign(
    {
      _id: 'req-1',
      ownerOpenid: 'owner-1',
      city: 'london',
      category: REQUEST_CATEGORY.ERRAND,
      title: '帮我从中超带点东西',
      preferences: {}
    },
    overrides
  )

const candidate = (overrides = {}) =>
  Object.assign(
    {
      openid: 'user-1',
      city: 'london',
      gender: GENDER.FEMALE,
      doneCount: 0,
      lastActiveAt: new Date(NOW - DAY)
    },
    overrides
  )

test('同城是最基本的一条依据，得分与权重表一致', () => {
  const res = scoreCandidate({ candidate: candidate({ lastActiveAt: null }), request: request(), nowMs: NOW })
  assert.equal(res.score, WEIGHTS.SAME_CITY)
  assert.deepEqual(res.evidence.map(item => item.field), ['city'])
  assert.equal(res.evidence[0].text, '常驻伦敦')
})

test('依据字段与得分必须对得上：总分等于各项权重之和', () => {
  const res = scoreCandidate({
    candidate: candidate({
      abilityTags: [REQUEST_CATEGORY.ERRAND],
      sameCategoryDoneCount: 2,
      doneCount: 3,
      avgResponseMinutes: 18
    }),
    request: request(),
    nowMs: NOW
  })
  const sum = res.evidence.reduce((acc, item) => acc + item.points, 0)
  assert.equal(res.score, sum, '总分只能来自依据 —— 多一分就说明有一条没写出来的理由')
  assert.deepEqual(res.evidence.map(item => item.field), [
    'city',
    'abilityTags',
    'sameCategoryDoneCount',
    'doneCount',
    'avgResponseMinutes',
    'lastActiveAt'
  ])
})

test('完成单数有上限，刷单刷不出无限高分', () => {
  const many = scoreCandidate({ candidate: candidate({ doneCount: 100 }), request: request(), nowMs: NOW })
  const capped = scoreCandidate({
    candidate: candidate({ doneCount: DONE_COUNT_CAP }),
    request: request(),
    nowMs: NOW
  })
  assert.equal(many.score, capped.score)
  const evidence = many.evidence.find(item => item.field === 'doneCount')
  assert.equal(evidence.text, '完成过 100 单', '展示给用户的是真实单数，只是不再多加分')
})

test('没有平均响应时长这个数据时不给分也不编话（M1 没有这个数据源）', () => {
  const res = scoreCandidate({ candidate: candidate(), request: request(), nowMs: NOW })
  assert.equal(res.evidence.some(item => item.field === 'avgResponseMinutes'), false)
})

test('太久没活跃的人不加活跃分', () => {
  const stale = scoreCandidate({
    candidate: candidate({ lastActiveAt: new Date(NOW - (RECENT_ACTIVE_DAYS + 1) * DAY) }),
    request: request(),
    nowMs: NOW
  })
  assert.equal(stale.evidence.some(item => item.field === 'lastActiveAt'), false)
})

test('硬门槛：发单人自己、外地人都不进候选', () => {
  assert.equal(rejectReason({ candidate: candidate({ openid: 'owner-1' }), request: request() }), SKIP_REASON.IS_OWNER)
  assert.equal(rejectReason({ candidate: candidate({ city: 'paris' }), request: request() }), SKIP_REASON.OTHER_CITY)
  assert.equal(rejectReason({ candidate: candidate(), request: request() }), null)
})

test('「仅同性响应」按 D-26 过滤：未填性别者不进候选，性别不符也不进', () => {
  const sameGender = request({ preferences: { [PREFERENCE_FLAG.SAME_GENDER_ONLY]: true } })
  const owner = { gender: GENDER.FEMALE }
  assert.equal(
    rejectReason({ candidate: candidate({ gender: GENDER.UNSET }), request: sameGender, owner }),
    SKIP_REASON.GENDER_UNSET
  )
  assert.equal(
    rejectReason({ candidate: candidate({ gender: GENDER.MALE }), request: sameGender, owner }),
    SKIP_REASON.GENDER_MISMATCH
  )
  assert.equal(rejectReason({ candidate: candidate({ gender: GENDER.FEMALE }), request: sameGender, owner }), null)
})

test('发单人自己没填性别时，「仅同性」单一个候选都不给 —— 宁可不推，不猜', () => {
  const sameGender = request({ preferences: { [PREFERENCE_FLAG.SAME_GENDER_ONLY]: true } })
  const res = selectCandidates({
    candidates: [candidate({ gender: GENDER.FEMALE })],
    request: sameGender,
    owner: { gender: GENDER.UNSET },
    nowMs: NOW
  })
  assert.equal(res.picked.length, 0)
})

test('候选不足 5 人时不补空', () => {
  const res = selectCandidates({
    candidates: [candidate({ openid: 'a' }), candidate({ openid: 'b' })],
    request: request(),
    owner: {},
    nowMs: NOW
  })
  assert.equal(res.picked.length, 2, '有两个人就给两个人，不凑数')
})

test('排序按得分降序，同分时结果稳定可复现', () => {
  const pool = [
    candidate({ openid: 'low', doneCount: 0, lastActiveAt: null }),
    candidate({ openid: 'high', doneCount: 4 }),
    candidate({ openid: 'mid', doneCount: 1 })
  ]
  const first = selectCandidates({ candidates: pool, request: request(), owner: {}, nowMs: NOW })
  const second = selectCandidates({ candidates: pool.slice().reverse(), request: request(), owner: {}, nowMs: NOW })
  assert.deepEqual(first.picked.map(item => item.openid), ['high', 'mid', 'low'])
  assert.deepEqual(
    first.picked.map(item => item.openid),
    second.picked.map(item => item.openid),
    '候选顺序变了推荐顺序不该变'
  )
})

test('推荐理由里出现依据之外的数字，一律判不可信', () => {
  const evidence = [
    { field: 'doneCount', value: 3, text: '完成过 3 单', points: 3 },
    { field: 'city', value: 'london', text: '常驻伦敦', points: 2 }
  ]
  assert.equal(verifyReason('常驻伦敦、完成过 3 单', evidence).ok, true)
  const bad = verifyReason('常驻伦敦、做过 8 次代购', evidence)
  assert.equal(bad.ok, false, '8 不在依据里，这是编的')
  assert.deepEqual(bad.unsupported, ['8'])
})

test('模板兜底：模型不可用时也能给出每个字都有据的理由', () => {
  const evidence = [
    { field: 'city', value: 'london', text: '常驻伦敦', points: 2 },
    { field: 'doneCount', value: 5, text: '完成过 5 单', points: 5 }
  ]
  const reason = templateReason(evidence)
  assert.equal(reason, '完成过 5 单、常驻伦敦', '按权重从高到低拼，重要的依据放前面')
  assert.equal(verifyReason(reason, evidence).ok, true, '模板拼出来的理由天然通过校验')
})

test('一条依据都没有的人不进名单：没有依据就写不出可解释的理由', () => {
  const res = selectCandidates({
    candidates: [candidate({ city: 'london' })],
    request: request({ city: 'london' }),
    owner: {},
    nowMs: 0
  })
  assert.equal(res.picked.length, 1, '同城本身就是一条依据')
  const noEvidence = selectCandidates({
    candidates: [{ openid: 'x', city: undefined }],
    request: request({ city: undefined }),
    owner: {},
    nowMs: 0
  })
  assert.equal(noEvidence.picked.length, 0)
  assert.equal(noEvidence.skipped[0].reason, SKIP_REASON.NO_EVIDENCE)
})
