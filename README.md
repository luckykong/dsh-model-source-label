# Model Source Label

在 Harness 的模型选择器里，把**模型来源**（服务商）用小字显示在模型名旁：`WB · Deepseek-V4.1-Flash`。
每个来源可以自定义一个简称（2-3 个字），留空则显示来源原名（如 `WorkBuddy`）。

## 效果

- 输入框下方模型选择器的按钮、下拉菜单当前项、菜单里的每个模型行，都会在模型名前显示一段小字来源。
- 来源 = 模型所在的 Provider（模型服务商）。默认显示该 Provider 的显示名；
  为它设置简称后显示简称，鼠标悬停可看到完整来源名与 Provider ID。

## 自定义简称

入口只有一个：**设置 → 模型**，页面底部的「模型来源简称」区块。

用法：

- 列表会自动收集来源：打开一次模型下拉菜单（或切换一次模型）后，出现过的来源都会登记进来。
- 在每行的「简称」输入框里填 2-3 个字，立即生效；点「恢复默认」还原为来源原名。
- 也可以在下方「手动添加来源」里直接填 Provider ID（如 `workbuddy`）和简称。
- 来源默认显示 Provider 的显示名（如 `WorkBuddy`），设置简称后立即替换。

简称保存在本机浏览器的 `localStorage` 中：

| key | 内容 |
| --- | --- |
| `dsh-model-source-label:labels` | `{ "<providerId>": "<简称>" }` |
| `dsh-model-source-label:seen` | `{ "<providerId>": "<来源显示名>" }` |

## 结构

- `index.js`：Host 半边（空实现，仅提供挂载行）。
- `client.js`：浏览器半边，注册
  - `conversation.input.model.label`（priority -1；single 槽位按优先级从低到高取第一个，因此低于内置的 0 即可覆盖，卸载后自动还原）；
  - `settings.models.footer`（设置 → 模型 页面底部的编辑区）。
- `cordis.patch.yml`：插入 `model-source-label` 一行。
- `locale/*.json`：插件管理页的标题与说明。

## 安装

要求在 DeepSeek Harness 里用 `plugin_manager` 的 `install_bundle`，`target` 传 git 地址：

```
github:luckykong/dsh-model-source-label
```

也可以固定到某个提交（推荐，版本可复现）：

```
github:luckykong/dsh-model-source-label#<commit-sha>
```

安装前请确认**当前没有 agent 在运行** —— 插件管理器在 agent 运行期间会拒绝安装。
装完后刷新页面即可看到效果；简称配置在「设置 → 模型」页面底部。

卸载：`plugin_manager` 的 `remove_bundle`，`target` 传 `dsh-model-source-label`。
卸载该 bundle 后，模型名恢复为 Harness 内置显示。
