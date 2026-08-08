# Icônes — Desktop (中文增强版)

跨 150+ 图标库、200,000+ 个图标，在 macOS 与 Windows 上原生运行的 [Iconify](https://iconify.design) 浏览器。主打**中文搜索**，也保留了原版的库内筛选、跳转图标库、参数滑块等能力。

本仓库基于 [ensaktas1/icones-desktop](https://github.com/ensaktas1/icones-desktop) 二次开发，功能与交互已明显分化。图标数据全部来自公开的 [Iconify API](https://iconify.design/docs/api/)。

![Icônes](docs/screenshot.png)

## 下载

最新版在 [**Releases**](https://github.com/mufanmu/icones-desktop-zh/releases/latest) 页面按平台下载（`Icones_0.1.x_universal.dmg` / `Icones_0.1.x_x64-setup.exe`）。应用内左下角会自动检测新版本，有更新时一键跳转下载页。

- **macOS**：下载 `.dmg`，双击挂载后把 **Icônes** 拖进「应用程序」即可。提供 Universal 通用包，Intel 与 Apple Silicon 都能原生运行。未做签名，首次打开需在 `系统设置 → 隐私与安全性` 点「仍要打开」放行。
- **Windows**：下载 `.exe` 安装包（x64，适用于绝大多数 PC）。未做签名，首次运行 SmartScreen 提示时，点「更多信息」→「仍要运行」放行。

## 特色功能

### 1. 中文直接搜
内置本地词典（**5000+ 词条 / 6300+ 中文词**），覆盖人物、美妆、服饰、动物、食物、家居、出行、运动、音乐、医疗、金融、节日、城市等几十个大类。搜「火锅」「春节」「扫地机器人」「伦敦」都能出结果；库里没有对应英文的词会自动跳过，不白搜。

<img width="1596" height="1017" alt="1" src="https://github.com/user-attachments/assets/3078d29e-6382-4a84-afbe-50aeec7a1728" />

### 2. 库内搜索
选中某个图标库后，搜索框会出现该库的标签，搜索自动限制在库内实时过滤，零网络延迟；中文在库内同样可搜。

<img width="1596" height="1017" alt="2" src="https://github.com/user-attachments/assets/1ef7685c-3e17-4c6c-9ccd-67af0f27248c" />

### 3. 结果更相关
搜索结果按相关度重排，搜 `camera` 不会把 `video-camera` 排到前面，首屏永远是相关度最高的图标。

### 4. 品牌词直达
搜 gpt、支付宝、微信、抖音、bilibili、比特币等 50+ 品牌词，直接展开对应图标。

### 5. 详情面板
尺寸/间距/旋转角三个参数支持滑块微调；点图标名下方的「跳转该库」可一键切到图标所在库。

<img width="1596" height="1017" alt="3" src="https://github.com/user-attachments/assets/151b8443-45a7-41cf-8bc4-9a2da179140f" />

### 6. 无限滚动
去掉「Load more」按钮，滚动到底部自动加载下一批，右下角实时显示 `Showing X of Y`，浏览体验更顺滑。

### 7. 版本检测
左下角显示当前版本号，发现新版本时提示「新版本 vX.Y.Z」，点击跳转下载页。

## 词典维护脚本

词典完全由 `scripts/` 下的脚本可复现生成：先从 Iconify 全库 236 个集合拉取真实图标名，拆出 34,000+ 英文词段作白名单；中文词映射成候选英文段后逐条验证，库里有才入库、没有的自动跳过；附覆盖度盘点与 HTML 报告。

## Tech

- [Tauri 2](https://tauri.app) — 原生外壳（Rust）
- [React 19](https://react.dev) + [Vite](https://vite.dev) + TypeScript
- [`@iconify/react`](https://iconify.design/docs/icon-components/react/) 渲染图标
- [`@iconify/utils`](https://iconify.design/docs/libraries/utils/) 生成 SVG

## 开发

```bash
npm install
npm run tauri dev      # 桌面应用 dev 模式
npm run dev            # 仅前端，http://localhost:1420
```

## 构建

### macOS

```bash
# 仅本机架构
npm run tauri build              # 产物在 src-tauri/target/release/bundle

# Universal 通用包（Intel + Apple Silicon 合一，发布推荐）
rustup target add x86_64-apple-darwin aarch64-apple-darwin   # 首次装好两个目标
npm run tauri:build:universal    # 产物在 src-tauri/target/universal-apple-darwin/release/bundle
```

> macOS 交叉编译需要 `rustup`（Homebrew 版 rust 不带其它架构的标准库）。

### Windows

```bash
# 需先安装 Rust（rustup.rs）与 Visual Studio Build Tools 的「使用 C++ 的桌面开发」工作负载
npm run tauri:build:windows-x64      # Intel/AMD，产物在 src-tauri/target/x86_64-pc-windows-msvc/release/bundle
```

> 打 `v*` tag 会触发 [.github/workflows/release.yml](.github/workflows/release.yml) 自动构建 macOS Universal `.dmg` 与 Windows `.exe`，发布到 Releases 并标记为最新版。

## 协议

- 应用代码遵循 MIT 协议 — 见 [LICENSE](LICENSE)
- 图标由 [Iconify](https://iconify.design) 提供，每个图标集保留各自协议（MIT、Apache-2.0、CC-BY 等），使用前请核对对应图标集
- 设计与初版实现来自 [ensaktas1/icones-desktop](https://github.com/ensaktas1/icones-desktop)
