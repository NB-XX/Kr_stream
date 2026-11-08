# KRStream

面向 SOOP (AfreecaTV)、Chzzk (Naver) 与 CI.ME 的独立多屏直播流媒体播放器（Chromium 浏览器扩展）。

---

## 核心特性

- **多平台直播流直达**
  - 解析 SOOP、Chzzk 与 CI.ME 直播流地址，支持最高 1080p60 原画及各档分辨率手动切换。
  - 支持 SOOP Catch 归档时光机与 Chzzk 时光机实时回看，可在直播进行中任意回退拖拽进度条，并支持一键追帧。

- **自适应多屏网格布局**
  - 预设 1 屏、2 屏、3 屏、4 屏、6 屏及自适应流式网格，窗口数量无上限。
  - 支持直接拖拽视频窗口实时重排布局顺序（CSS Grid Order），并自动持久化窗口排列。
  - 支持独立 Popup 悬浮小窗模式，便于画中画置顶或多任务监看。

- **分窗口独立 CDN 调度**
  - 每个播放窗口的控制栏均可独立配置加速 CDN 节点（SOOP: Global 1 / Global KR / KR Zone；Chzzk: GCDN / Akamai / Naver Edge / Naver 专属；CI.ME: Amazon IVS / CloudFront）。
  - 各窗口独立记忆 CDN 偏好，解决跨网或国际链路抖动导致的卡顿。

- **原生实时 AI 字幕引擎**
  - **SOOP**：通过底层 WebSocket 信令通道（Opcode 0137/0136）并行订阅双语 AI 实时字幕，延迟小于 1 秒。
  - **CI.ME**：轮询官方字幕接口（`/api/app/live-captions/{slug}`），自动获取说话人角色及时间戳。
  - **多语种覆盖**：支持韩语、英语、简体中文、繁体中文、泰语、日语、越南语、印尼语 8 种语言。
  - **交互式字幕面板**：提供主副字幕双列自由配对、双语切换开关，以及字号（12px–22px）、不透明度、字体颜色和文本对齐设置。
  - **字幕历史记录**：侧边抽屉式时间轴面板，支持自动截图当前视频帧并关联字幕历史。

- **原生 WebSocket 实时弹幕与表情包**
  - 直连 SOOP 与 Chzzk 原生弹幕通道，低开销渲染滚动弹幕。
  - 自动识别并渲染主播专属签名表情贴纸与平台表情代码。
  - 控制栏提供弹幕开关、同屏密度限制、透明度与滚动速度调节。

- **账号与关注状态同步**
  - 自动读取浏览器当前登录态（SOOP UserTicket / Naver NID 等），无需在插件内输入账号密码。
  - 切换或打开播放器标签页时自动刷新关注列表与开播状态。

- **音频超频与本地录制**
  - 基于 Web Audio API 提供 100% 至 300% 音量增益放大。
  - 支持无损视频帧 PNG 截图与 HLS 直播片段录制（直接输出 MP4 文件）。

---

## 目录结构

```
krstream/
├── manifest.json              # Manifest V3 扩展配置文件
├── background.js             # Service Worker (DNR 鉴权路由与生命周期管理)
├── core/                     # 核心服务层
│   ├── account-manager.js    # Cookie 凭证检测、DNR 规则装载与关注同步
│   ├── stream-resolver.js    # 直播流地址解析与时光机回看 API
│   └── storage.js            # 本地配置与状态持久化
├── player/                   # 独立播放控制台
│   ├── player.html           # 多屏主工作台页面
│   ├── player.js             # 槽位管理器、网格拖拽与播放调度
│   ├── player.css            # 播放器暗色控制台样式
│   ├── danmaku-engine.js     # WebSocket 弹幕引擎与表情渲染
│   └── subtitle-engine.js    # 实时字幕引擎与双语配对
├── vendor/                   # 第三方依赖库 (hls.js, mux.js)
├── tests/                    # 自动化测试套件
└── icons/                    # 扩展图标
```

---

## 安装与运行

### 开发者模式加载

1. 下载或克隆本项目仓库到本地：
   ```bash
   git clone https://github.com/your-username/krstream.git
   ```
2. 打开 Chromium 内核浏览器（Chrome、Edge、Brave 等），在地址栏访问：
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
3. 开启页面右上角的 **开发者模式 (Developer mode)**。
4. 点击 **加载已解压的扩展程序 (Load unpacked)**，选择本项目的根目录文件夹。
5. 点击浏览器右上角工具栏的扩展图标，即可直接打开独立播放工作台。

---

## 测试

项目使用 Node.js 原生测试断言，无需安装额外依赖：

```bash
npm test
```

测试覆盖：
- 双 WebSocket 信道建立与 Opcode 0137/0136 载荷协议；
- SOOP 8 种官方语言与内部数字编码映射；
- 中韩/双语实时字幕配对与状态持久化；
- 弹幕去重与表情代码解析。

---

## 快捷键与操作

| 快捷键 / 操作 | 功能描述 |
| :--- | :--- |
| `Space` | 聚焦窗口 播放 / 暂停 |
| `M` | 静音 / 取消静音 |
| `F` | 全屏 / 退出全屏 |
| `D` | 切换当前窗口弹幕开关 |
| `右键 [字幕] 按钮` | 调出 B 站规格字幕语言与样式设置面板 |
| `拖拽窗口标题栏` | 自由交换多屏窗口顺序 |
| `左侧栏主播卡片点击` | 载入并播放目标直播流 |

---

## 隐私与安全说明

- 本扩展不包含任何数据遥测、外部统计代码或第三方追踪脚本。
- 账号凭据均通过 Chromium 提供的 `chrome.cookies` API 在本地读取，且所有声明式网络请求（Declarative Net Request）规则均严格限制发起方域（`initiatorDomains`）为扩展自身，不会干扰正常网页的请求行为。

---

## 开源许可

本项目基于 [MIT License](LICENSE) 开源。
