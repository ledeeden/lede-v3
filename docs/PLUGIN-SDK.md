# 动态视图与插件 SDK v1

## 优先级

先用内置 `markdown / metric / table / cards / chart / tasks / timeline / relations` 组合。确实缺表达能力时再创建 JS/TS/TSX Widget。Widget、View、Mount 是三个独立实体；移除挂载不删除视图，删除视图不删除插件类型。

## 生命周期

`draft → built → previewed → registered → disabled`。源码/Manifest 修改使构建与预览失效；错误进入 error。注册和停用版本都不可再修改，修复应创建新版本。

Bot Tools 只暴露 propose/build，不暴露 approve/register。用户在插件页实际预览后点击注册，再创建引用它的 View。当前单用户 HTTP 主机是用户权限入口，不把浏览器预览回执当成强安全认证。

## Manifest 示例

```json
{
  "id": "research.evidence",
  "version": "1.0.0",
  "name": "证据卡",
  "description": "比较项目资料并回传选择",
  "entry": "index.tsx",
  "propsSchema": {
    "type": "object",
    "properties": {"title": {"type": "string"}},
    "additionalProperties": false
  },
  "capabilities": ["selection", "context", "state", "resize"]
}
```

只能使用支持的 JSON Schema 子集：type/properties/required/additionalProperties/items/enum/const/oneOf、字符串/数字/数组边界、有限正则。`$ref` 等未实现关键字发布时拒绝，不静默忽略。

`capabilities` 决定主机接收的消息类型；不是系统权限策略。`context` 仅指当前 View/Block 信息，不会授予数据库访问。

## 入口代码

```tsx
export default function mount(root: HTMLElement, props: any, sdk: any) {
  const title = h('h3', {}, props.title || '项目证据');
  root.append(title);
  const rows = Array.isArray(sdk.data) ? sdk.data : [];
  for (const row of rows) {
    root.append(
      <button onclick={() => sdk.select({
        resourceIds: [row.id],
        key: row.id,
        excerpt: row.title
      })}>{row.title}</button>
    );
  }
  return () => root.replaceChildren();
}
```

`h`、`Fragment` 在沙箱内提供。TSX 的 `onclick` 是 DOM 属性，不是 React 的合成事件模型。不允许导入 npm、网络包或动态 import。编译执行 `transpileModule`：**包含语法检查，不包含完整 TypeScript 类型分析**。运行错误在预览中显示。

## sdk

| 属性/方法 | 含义 |
|---|---|
| `sdk.data` | 当前 Block 数据绑定解析结果 |
| `sdk.context` | `{viewId, blockId}`；预览不一定有正式 View |
| `sdk.select({resourceIds,key,excerpt})` | 回传选中对象/数据说明；引用必须在当前数据内 |
| `sdk.state` | 当前 View + Block 上次保存的交互状态快照 |
| `sdk.setState(object)` | 保存≤16KB的局部状态；需要 state capability；不直接改知识/任务 |
| `sdk.resize(height)` | 建议高度，宿主限制到160–1000px |

`setState` 不自动驱动组件重渲染；插件需要维护本地变量并更新 DOM。跨挂载/刷新后宿主重新注入已存状态。完整可运行样例：`examples/plugins/persistent-counter.json`。

## ViewSpec

```json
{
  "title": "项目资料与进展",
  "mode": "live",
  "blocks": [
    {
      "id": "evidence",
      "type": "widget:research.evidence@1.0.0",
      "props": {"title": "可追溯资料"},
      "dataSource": {
        "kind": "query",
        "query": {"kind": "object", "projectId": "实际项目ID"}
      },
      "layout": {"x": 20, "y": 20}
    }
  ]
}
```

绑定支持 query/resource/inline；query 只允许有限类型和字段，不执行任意 SQL。资源绑定使用 canonical URI。快照模式保存解析结果；Live 每次取最新。默认查询结果上限100，可配置至服务允许范围。

增量更新通过 `/api/view/patch`：`addBlock {block}`、`updateBlock {id,patch}`、`removeBlock {id}`、`setTitle {value}`、`setMode {value}`。必须附 `baseRevision`，409 后重新读取并协调，不能偷偷覆盖。

## 主机安全接口

插件运行在 opaque-origin iframe 内，没有 Key、FS、Node、ToolRegistry 或主窗口 DOM。postMessage 双向校验 frame/source/nonce；选择交给负责人，不直接执行 Agent 命令。CSP 禁止普通网络，插件导航会触发卸载。

此边界不提供 CPU/内存限制；不可把不可信代码预览当成无风险。更多限制见 SECURITY.md。
