/**
 * 站内语料检索的编排（M2-09）。**只做查询与拼装，打分在 `ai/knowledgeRank.js`。**
 *
 * 为什么检索不在数据库里做：云数据库没有全文索引，也做不了中文分词。
 * 所以这一层把候选捞回内存（按城市 + 标签窄化），排序交给纯函数 —— 顺带让打分可单测。
 */

const knowledgeDao = require('../dao/knowledge')
const { TOP_N, inferTags, rankCandidates } = require('../ai/knowledgeRank')

/**
 * 检索。
 *
 * @param {object} options
 * @param {string} options.city   城市 code（`london`）
 * @param {string} options.question
 * @param {number} [options.limit]
 * @returns {Promise<{tags: string[], snippets: object[], candidateCount: number}>}
 */
const search = async ({ city, question, limit = TOP_N }) => {
  const tags = inferTags(question)

  let candidates = await knowledgeDao.listCandidates({ city, tags })
  // 标签窄化后一条都没有，就退回全城候选再按文本打分 ——
  // 标签是加速手段，不该变成"没标签就查不到"的硬门槛
  if (!candidates.length && tags.length) {
    candidates = await knowledgeDao.listCandidates({ city })
  }

  const ranked = rankCandidates({ candidates, question, limit })
  return Object.assign({ candidateCount: candidates.length }, ranked)
}

module.exports = {
  search
}
