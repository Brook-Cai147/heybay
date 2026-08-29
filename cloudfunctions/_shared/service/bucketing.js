/**
 * A/B 分桶（纯逻辑）。
 *
 * 存在理由见 D-21：埋点与分桶必须在 M1 就做，事后补等于历史数据缺失，等于放弃验证 AI 价值。
 * 但当前**零真实用户**，所以本步只做"数据不缺失"这一半（D-31）：
 *   - 做：把一个稳定的桶号埋进每条事件，将来有用户时历史数据能用
 *   - 不做：实验配置、分组比例、多实验并存、对比分析 —— 全部推到 M5
 *
 * 铁律：纯函数。不读数据库、不用随机数、不取当前时间 —— 同一个人必须永远落同一个桶，
 * 否则实验组会在中途漂移，数据直接作废。
 */

/** 桶的总数。改这个值会让所有历史桶号失去可比性，**不要改** */
const BUCKET_COUNT = 100

/** M1 只用这一个实验 key：桶号此时的作用是"用户的稳定随机标识"，不代表任何实验分组 */
const DEFAULT_EXPERIMENT_KEY = 'default'

/**
 * FNV-1a 32 位哈希。选它的理由：零依赖、实现短到能一眼看懂、分布够均匀。
 * 不用 crypto 是为了让这个函数在云函数与将来可能的端侧场景里都能跑。
 * @param {string} text
 * @returns {number} 无符号 32 位整数
 */
const stableHash = text => {
  let hash = 0x811c9dc5
  const input = String(text)
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    // 等价于 hash *= 16777619，用位移避免大数精度问题
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0
  }
  return hash >>> 0
}

const isUsableOpenid = openid => typeof openid === 'string' && openid.trim() !== ''

/**
 * 算出某个用户在某个实验里的桶号。
 *
 * openid 缺失或非法时返回 null（表示"未入桶"）而不是抛错 —— 埋点绝不能阻断主流程，
 * 上报侧把 null 原样写进事件即可，事后能一眼看出是哪些数据没有桶号。
 *
 * @param {string} openid
 * @param {string} [experimentKey] 实验标识，M1 一律用默认值
 * @returns {number|null} 0 ~ 99，或 null
 */
const bucketOf = (openid, experimentKey = DEFAULT_EXPERIMENT_KEY) => {
  if (!isUsableOpenid(openid)) return null
  const key = isUsableOpenid(experimentKey) ? experimentKey : DEFAULT_EXPERIMENT_KEY
  // 用 openid 与实验 key 一起做哈希：同一个人在不同实验里落不同桶，避免实验间相互污染
  return stableHash(`${key}:${openid}`) % BUCKET_COUNT
}

module.exports = {
  BUCKET_COUNT,
  DEFAULT_EXPERIMENT_KEY,
  stableHash,
  bucketOf
}
