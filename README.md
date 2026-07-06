# Icônes — Desktop (中文增强版)

跨过 150+ 图标库、200,000+ 个图标，在 macOS 上原生运行的 [Iconify](https://iconify.design) 浏览器——支持中文搜索、库内 OneBox 风格筛选、跳转图标库、参数滑块等。

本仓库基于 [ensaktas1/icones-desktop](https://github.com/ensaktas1/icones-desktop) 二次开发，已与原版在功能与交互上发生显著分化。所有图标数据仍来自公开的 [Iconify API](https://iconify.design/docs/api/)。

![Icônes](docs/screenshot.png)

## 下载

打开本仓库的 [**Releases**](https://github.com/mufanmu/icones-desktop-zh/releases/latest) 拿到最新 `.dmg`，双击挂载后把 **Icônes** 拖进 **应用程序** 文件夹即可。

> 当前仅 **Apple Silicon (arm64)**。Intel 构建后续会补上。
> 此版本未做 Apple Developer 签名，首次打开时需在 `系统设置 → 隐私与安全性` 点「仍要打开」放行一次，或终端执行：
> ```
> xattr -dr com.apple.quarantine "/Applications/Icônes.app"
> ```

## 与原版相比的优化

### 1. 中文模糊搜索
- 新增本地词典 `public/zh-dict.json`（1000+ 词条 / 1900+ 中文词），覆盖常用概念、动物、水果蔬菜、运动、运动器械、建筑、地标、家电、医疗、几何形状、AI/机器人、自然、载具、人物表情等数十个分类
- 新增 `src/lib/zhSearch.ts`：CJK 自动检测、词典懒加载、整句/子串/片段三级匹配回退
- 输入中文时按词条翻译成英文检索词，并发调用 Iconify `search` API 并集去重
<img width="1596" height="1017" alt="1" src="https://github.com/user-attachments/assets/3078d29e-6382-4a84-afbe-50aeec7a1728" />

### 2. 库内 OneBox 风格搜索
- 选中侧边栏图标库或在详情面板点击「跳转该库」时，搜索框内出现库 pill（仿 macOS Finder 的 tokenized input 模式）
- 点 pill 主体清空关键词回到该库浏览；点 pill 叉号或 Backspace 按段删两次回全局搜索
- pill 命中后搜索自动限制在该库内做本地实时过滤，零网络延迟
- 库内中文搜索同样支持（先翻译再过滤图标名）
<img width="1596" height="1017" alt="2" src="https://github.com/user-attachments/assets/1ef7685c-3e17-4c6c-9ccd-67af0f27248c" />


### 3. 详情面板：库跳转
- 选中图标后，详情头部图标名下方新增「跳转该库」链接，点击直接切到对应图标库的浏览视图（应用内切换，非外链）

### 4. 详情面板：参数滑块 + 输入 Bug 修复
- 尺寸、Padding、旋转角三个参数都加了滑块，与输入框同步
- 默认尺寸由 18px 改为 24px
- 修复原版输入 Bug：18px → 输入 24 会变成 44（每键即 clamp 误导）；Padding/旋转 输入 80 会变成 080（前导零未清）。改用本地文本状态、blur 时夹紧、`stripLeadingZeros` 清前导零
<img width="1596" height="1017" alt="3" src="https://github.com/user-attachments/assets/151b8443-45a7-41cf-8bc4-9a2da179140f" />

### 5. 启动交互
- 启动后默认浏览第一个库（lucide），搜索框无 pill，搜索直接走全局，不被某个库限制
- 顶部 logo 改为 GitHub 仓库链接

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

```bash
npm run tauri build    # 产物在 src-tauri/target/release/bundle
```

## 协议

- 应用代码遵循 MIT 协议 — 见 [LICENSE](LICENSE)
- 图标由 [Iconify](https://iconify.design) 提供，每个图标集保留各自协议（MIT、Apache-2.0、CC-BY 等），使用前请核对对应图标集
- 设计与初版实现来自 [ensaktas1/icones-desktop](https://github.com/ensaktas1/icones-desktop)
