# 订阅发布前核对 · 2026-09-22

结论：2.x 到当前 3.0 候选并非没有订阅改动。无需重新执行完整支付矩阵，但 Google Play 购买链路仍需最小实测，当前不记作通过。

## 代码与已有证据

- 对比 `717f265^` 与当前工作区：`apps/mobile/src/services/pro-subscription.ts` 的会员过期判断、强制刷新 CustomerInfo、当前套餐识别、购买结果判断均有调整；Android 切换订阅会构建 `GoogleProductChangeInfo` 并传入 `purchasePackage`。付费墙和会员状态 Context 亦有变动。
- 底层仍为 RevenueCat；声明的 `react-native-purchases` 版本仍是 `^9.11.2`。这不等于整个支付逻辑未变。
- 现有单元测试覆盖套餐选择、过期、状态与错误分类；此前 required 已通过。这些使用测试数据的检查不能替代商店扣款流程。
- 负责人确认已上传 13 个 TestFlight 版本，并多轮测试 iOS/Android；应认可这些测试，不能概括为“只有 QA”。目前未能从记录确认其中是否包含最终版本的购买和恢复购买，未要求重跑整个 iOS 验收。

## 只读核对设备与 Google Play

- 已连接 Samsung SM-A566B。商店安装的 `com.p697.clawket` 为 2.1.0 / 20109；并存的本地 `com.p697.clawket.qa` 为 3.0.0 / 30000。
- Play Console 的最新 app bundle 为 2.1.0 / 20109；正式轨道 20109，封闭测试 20108，内部测试 10700（Clawket 1.7）。未见可安装的 3.0 内部测试候选。
- 因此没有用旧 2.1 或不同包名的 QA 包冒充 3.0 Google Play 支付验收。本轮未安装/清空手机数据、购买或修改商店配置。
- 内部测试人员资格不等于免费内购资格。还需核对手机使用的 Google 账号属于 license tester，并在付款页看到测试支付工具，才执行免扣款测试。本轮尚未核对该账号资格。

## 最小补测范围

准备正式包名的 3.0 候选和许可测试账号后，只补以下主路径：一次测试订阅成功并解锁会员；重启和恢复购买仍正确；月付/年付切换按商店展示的生效时点更新。旧版会员可用性可结合这台手机覆盖升级检查。暂不展开完整续费、退款、宽限期等矩阵。

Google Play 缺口属于 Android 客户端验收，不应单独阻塞 Bridge/服务端发布或 iOS 提审；后两者仍应按各自发布门禁判断。

依据：[Google Play Billing 测试说明](https://developer.android.com/google/play/billing/test)。
