# 依赖告警（npm audit）

> 快照来源：根目录 `npm audit`（2026-05-29）。**安全项已处理**；`vue-i18n` 见 `DOC/07-vue-i18n-migration.md`。

## 已修复（2026-05-29）

| 包 | 原版本 | 修复版本 | 说明 |
|----|--------|----------|------|
| `marked` | 18.0.1 | **18.0.4** | web 直接依赖；聊天气泡 Markdown（`render-rich-message.ts`） |
| `fast-uri` | 3.1.0 | **3.1.2** | 传递依赖（Fastify → ajv）；lockfile 升级 |

验证：`npm audit` → **0 vulnerabilities**。

## 已迁移（2026-05-29）

- **vue-i18n** 9.14.5 → **11.4.4**（`legacy: false` 保持不变）；见 `DOC/07-vue-i18n-migration.md`。

---

## 历史原始输出（归档）

<details>
<summary>修复前的 npm 输出</summary>

```
npm warn deprecated vue-i18n@9.14.5: v9 and v10 no longer supported. please migrate to v11.

# npm audit report

fast-uri  <=3.1.1  Severity: high  (fix: npm audit fix)
marked    18.0.0 - 18.0.1  Severity: high  (fix: npm audit fix)
```

</details>
