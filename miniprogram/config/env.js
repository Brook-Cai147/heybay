/**
 * 云开发环境与运行期开关（端侧）。
 *
 * **环境 ID 不是密钥。** 客户端必须知道它才能 `wx.cloud.init`，反编译体验版即可看到；
 * 安全性靠数据库权限收紧（M1-07：集合仅云函数可读写）与云函数侧鉴权，不靠隐藏它。
 * 因此它入库，且只在这一处出现 —— 页面里不许再写环境 ID。
 *
 * 真正的密钥（AI API Key、微信 AppSecret）只放云函数环境变量，永远不出现在小程序代码里
 * （tech-stack 6.1）。
 */

/**
 * 云开发环境 ID。
 * 环境名 cloud1，免费开发环境（2026-08-29 于云开发控制台创建）。
 */
const CLOUD_ENV_ID = 'cloud1-d5gwcen6nb1c1fdeb'

/**
 * 联调数据标记。为 true 时所有写操作都带 `_isTest: true`，正式查询里排除
 * （tech-stack 第 2 节的单环境纪律）。M1 联调期保持 true，真实运营前改 false。
 */
const IS_TEST_DATA = true

module.exports = {
  CLOUD_ENV_ID,
  IS_TEST_DATA
}
