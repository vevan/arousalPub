# TODO（未完成项）

> **阶段**：已脱离 MVP（2026-05+）。下列为**仍待做**；已实现能力见 `DOC/03` §14.7、各专题文档、`DOC/README` 归档表。

## P0 余项

- [ ] **对话页正则批量 apply UI**（API 已有 `POST .../regex/apply`；`DOC/24` §2）

## P1

- [ ] **消息树 / 分支 UI** — `DOC/23` §6（服务端 memory/枚举已就绪）
- [ ] **会话消息 UI 懒加载** — `DOC/15`（`tail`/`before` query + 上滚；底层 `readTurnsTail` ✅）
- [ ] **独立文档 RAG**（≠ 世界书 vector）— 可选；前置 `DOC/20` M1+M4
- [ ] RAG 参数面板、会话/角色批量导入导出、备份示例脚本

## P2 / P3

- [ ] 插件实例与 API 绑定、插件审计、fallback 策略（部分 host API 见 `DOC/10`）
- [ ] **用户文件库** `DOC/20` M1–M5
- [ ] ST 宏扩展备忘 `DOC/14`；Embedding MRL / Reranker / Qwen instruct（低优先级）

## 文档

- [ ] 架构/接口变更时同步 `DOC/01`–`03`（本次 2026-06-10 已做索引压缩）
