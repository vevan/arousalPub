# 依赖告警（npm audit）

> 快照：2026-10-23。`npm audit` → **0 vulnerabilities**。

## 当前固定的修补版本

| 包 | 版本 | 说明 |
|----|------|------|
| `dompurify` | 3.4.17 | 对话气泡 / 插件面板 HTML 消毒（critical：`SAFE_FOR_TEMPLATES` / `IN_PLACE` 载荷逃逸） |
| `handlebars` | 4.7.10 | 模板编译（critical：`compile` AST 类型混淆注入）；内嵌进插件 dist 的运行时同样需重建 |
| `fast-jwt` | 6.3.5 | 经 `@fastify/jwt` 10.2.5 引入（critical：算法混淆 / 公钥 JWK 当 HMAC 密钥） |
| `@fastify/busboy` | 3.2.4 | 经 `@fastify/multipart` 10.1.6 引入（multipart DoS / CRLF 注入） |
| `brace-expansion` | 5.0.12 | 经 `minimatch` 引入（递归栈溢出 DoS） |
| `fast-uri` | 3.1.9（嵌套 4.2.3） | 经 `ajv` / `fast-json-stringify` 引入 |
| `source-map-js` | 1.2.2 | 经 `postcss` / `@vue/compiler-*` 引入 |
| `sharp` | 0.35.5 | 根 `overrides` 固定；librsvg CVE |
| `vue` / `@vue/*` | 3.5.44 | `@vue/compiler-dom` / `@vue/server-renderer` XSS |
| `vite` | 8.3.5 | 开发与构建链 |
| `fastify` | 5.12.7 | 传递 `ajv` / `fast-json-stringify` 修复 |
| `marked` | 18.0.4 | Markdown 渲染 |
| `vue-i18n` | 11.4.16 | `legacy: false` 不变 |

验证：`npm audit`（推送前必跑，见 `AGENTS.md` §依赖安全与推送门禁）。

注意：`npm audit fix` 对其中多数条目会报 **No fix available**——补丁版本本身可用，是旧 lockfile 把条目锁在旧补丁上；须显式提升 manifest 版本，或对传递依赖在原有 caret 范围内 `npm update`。禁止 `npm audit fix --force`。

<details>
<summary>历史修复前输出（归档）</summary>

```
npm warn deprecated vue-i18n@9.14.5
fast-uri <=3.1.1 — high
marked 18.0.0 - 18.0.1 — high
```

```
dompurify <=3.4.16 — critical
handlebars <=4.7.9 — critical
fast-jwt <=6.3.3 — critical
@fastify/busboy <3.2.2 — high
brace-expansion >=4.0.0 <5.0.12 — high
sharp <0.35.5 — high
@vue/server-renderer <3.5.42 — high
vite >=8.0.0 <=8.1.5 — high
```

</details>
