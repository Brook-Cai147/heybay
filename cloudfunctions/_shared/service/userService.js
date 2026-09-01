/**
 * 用户建档与资料维护（M1-08）。
 *
 * 身份只来自 `cloud.getWXContext()` 的 openid（D-33），**不采集手机号**（D-26）。
 * 昵称头像由端侧传入 —— 它们是用户自己选的展示信息，填错只影响自己，与鉴权无关。
 */

const usersDao = require('../dao/users')
const { GENDER, GENDER_VALUES, CONTACT_TYPE_VALUES } = require('../constants/enums')
const { ERROR, fail, ok } = require('../constants/errors')

/** 联系方式的长度上限。够写国际号码与常见 ID，又不至于被塞进一整段广告 */
const CONTACT_VALUE_MAX = 60

/** M1 的信任分起点：L1 基础 10 分，徽章统一「新面孔」（信任分算法属 M2） */
const INITIAL_TRUST = Object.freeze({ trustScore: 10, trustLevel: 'newcomer' })

const NICKNAME_MAX = 30

/** 端侧可自填的展示字段，逐个过滤，避免端侧塞进 trustScore 之类的东西 */
const pickProfile = params => {
  const profile = {}
  if (typeof params.nickName === 'string' && params.nickName.trim()) {
    profile.nickName = params.nickName.trim().slice(0, NICKNAME_MAX)
  }
  if (typeof params.avatarUrl === 'string' && params.avatarUrl.trim()) {
    profile.avatarUrl = params.avatarUrl.trim()
  }
  return profile
}

/**
 * 登录建档：不存在则建，存在则更新最后活跃时间。**必须幂等**。
 *
 * 幂等有两道保障：先查后写；`users.openid` 唯一索引兜住并发下的重复插入
 * （插入冲突后改为读取，而不是把数据库报错抛给端侧）。
 */
const login = async ({ openid, params = {}, isTest = false }) => {
  const profile = pickProfile(params)
  const existing = await usersDao.findByOpenid(openid)

  if (existing) {
    await usersDao.updateByOpenid(openid, Object.assign({ lastActiveAt: new Date() }, profile))
    const user = await usersDao.findByOpenid(openid)
    return ok({ created: false, user: publicUser(user) })
  }

  const doc = Object.assign(
    {
      openid,
      nickName: '',
      avatarUrl: '',
      city: '',              // 常驻城市留空，由用户在个人页自选
      gender: GENDER.UNSET,  // 性别自填，未填不能响应「仅同性」的单（D-26）
      lastActiveAt: new Date()
    },
    INITIAL_TRUST,
    profile
  )

  try {
    await usersDao.insert(doc, isTest)
    const user = await usersDao.findByOpenid(openid)
    return ok({ created: true, user: publicUser(user) })
  } catch (err) {
    // 唯一索引冲突：说明另一次并发调用刚建完，读出来返回即可 —— 这才是"幂等"
    const again = await usersDao.findByOpenid(openid)
    if (again) return ok({ created: false, user: publicUser(again) })
    throw err
  }
}

/**
 * 更新常驻城市与性别。M1-17 的「补全性别后可响应仅同性单」靠这个动作。
 * 性别一旦填了仍可改 —— 它是自填字段，不是身份认证（D-26）。
 */
const updateProfile = async ({ openid, params = {} }) => {
  const patch = pickProfile(params)

  if (params.city !== undefined) {
    if (typeof params.city !== 'string' || !params.city.trim()) {
      fail(ERROR.BAD_PARAMS, '常驻城市不能为空')
    }
    patch.city = params.city.trim()
  }
  if (params.gender !== undefined) {
    if (!GENDER_VALUES.includes(params.gender)) {
      fail(ERROR.BAD_PARAMS, `性别取值不对：${params.gender}`)
    }
    patch.gender = params.gender
  }

  /**
   * 联系方式（D-36）。存在 `users.contact` 上，**只在选定后由 getDetail 下发给对方**，
   * 任何列表、卡片、`publicUser` 都不带它。传 `{ type, value }`；value 为空表示清空。
   */
  if (params.contact !== undefined) {
    patch.contact = normalizeContact(params.contact)
  }
  if (!Object.keys(patch).length) {
    fail(ERROR.BAD_PARAMS, '没有需要更新的字段')
  }

  const updated = await usersDao.updateByOpenid(openid, patch)
  if (!updated) fail(ERROR.NO_IDENTITY, '还没有你的档案，请先登录')

  const user = await usersDao.findByOpenid(openid)
  return ok({ user: publicUser(user), myContact: contactOf(user) })
}

/** 取当前用户档案；没有档案返回 null 而不是报错（端侧据此决定是否调 login） */
const getMe = async ({ openid }) => {
  const user = await usersDao.findByOpenid(openid)
  // 自己的联系方式内容要回给自己（要能看到填了什么、能改），但不进 publicUser
  return ok({ user: user ? publicUser(user) : null, myContact: contactOf(user) })
}

/** 只回传端侧真正需要的字段，不把整条文档（含 _isTest 等内部字段）倒给前端 */
const publicUser = user => {
  if (!user) return null
  return {
    _id: user._id,
    openid: user.openid,
    nickName: user.nickName || '',
    avatarUrl: user.avatarUrl || '',
    city: user.city || '',
    gender: user.gender || GENDER.UNSET,
    trustScore: user.trustScore,
    trustLevel: user.trustLevel,
    doneCount: Number.isInteger(user.doneCount) ? user.doneCount : 0,
    // 只回"填没填"，**不回内容** —— 内容只在选定后由 getDetail 下发给对方（D-36）
    hasContact: Boolean(user.contact && user.contact.value)
  }
}

/**
 * 归一化联系方式。空值表示清空（用户有权撤回自己的联系方式）。
 * 这里不校验号码格式：全球号码与各类 ID 的格式千差万别，误拦比放过更烦人。
 */
const normalizeContact = raw => {
  if (raw === null || raw === '' || raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(ERROR.BAD_PARAMS, '联系方式格式不对，应为 { type, value }')
  }
  const value = typeof raw.value === 'string' ? raw.value.trim() : ''
  if (!value) return null
  if (!CONTACT_TYPE_VALUES.includes(raw.type)) {
    fail(ERROR.BAD_PARAMS, `联系方式类型不对：${raw.type}`)
  }
  if (Array.from(value).length > CONTACT_VALUE_MAX) {
    fail(ERROR.BAD_PARAMS, `联系方式不超过 ${CONTACT_VALUE_MAX} 字`)
  }
  return { type: raw.type, value }
}

/** 对方可见的联系方式。没填时回 null，让页面显示"对方还没填"而不是空白 */
const contactOf = user => {
  if (!user || !user.contact || !user.contact.value) return null
  return { type: user.contact.type, value: user.contact.value }
}

module.exports = {
  INITIAL_TRUST,
  CONTACT_VALUE_MAX,
  login,
  updateProfile,
  getMe,
  publicUser,
  contactOf
}
