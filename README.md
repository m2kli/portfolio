# 游戏作品集网站

Astro + GSAP 构建的静态作品集，编辑杂志风格，中英双语，部署到 GitHub Pages。

## 本地开发

需要 Node.js 22.23 或更高版本。

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # 输出到 dist/
npm run preview    # 预览构建结果
```

## 修改个人信息

编辑 `src/data/site.ts`：名字、邮箱、社交链接、首页大标题、简介、能力和经历（中英各一份）。
大标题每一项是一行，用 `*单词*` 把某个词标成红色斜体。

关于页的头像目前是 SVG 占位图，在 `src/views/AboutView.astro` 里换成 `<img>` 即可。

## 新增一个作品

1. 在 `public/works/<slug>/` 放封面和截图（推荐封面 3:4，截图 16:10，jpg / webp / png / svg 都可以）。
2. 新建 `src/content/works/zh/<slug>.md` 和 `src/content/works/en/<slug>.md`，两边的文件名必须相同。
3. 复制已有作品的 frontmatter 修改。字段说明见 `src/content.config.ts`：

| 字段 | 说明 |
|---|---|
| `title` / `subtitle` / `summary` | 标题、副标题、一句话简介 |
| `year` `role` `team` `duration` `engine` `platforms` `tags` | 详情页信息栏 |
| `cover` | 封面，路径相对 `public/` |
| `gallery` | 截图列表 `{ src, caption }`，点击可放大 |
| `video` | 预告片：`{ type: youtube, src: 视频ID }`、`{ type: bilibili, src: BV号 }` 或 `{ type: local, src: works/x/trailer.mp4 }` |
| `playable` | 在线试玩：`{ src: demos/<slug>/index.html, aspect: 16/9, note }`，`src` 也可以是 itch.io 的嵌入地址 |
| `links` | 按钮：`type` 可选 itch / steam / download / github / website / video |
| `order` | 排序（越小越靠前） |
| `featured` | 设为 false 则不在首页出现 |

正文用 Markdown 写设计笔记，支持标题、列表、引用、加粗等。

## 放入可在线游玩的 Demo

把 WebGL / HTML5 导出整个文件夹放到 `public/demos/<slug>/`（入口为 `index.html`），然后在作品的 `playable.src` 写 `demos/<slug>/index.html`。
页面上只显示封面和"点击开始"，访客点击后才加载 iframe，体积大的构建不会拖慢页面。

- **Godot**：导出 Web 版即可。若提示需要 SharedArrayBuffer，导出时关闭 *Thread Support*（GitHub Pages 无法设置 COOP/COEP 响应头）。
- **Unity**：Player Settings → Publishing Settings 里把 *Compression Format* 设为 **Disabled**，或者开启 *Decompression Fallback*。GitHub Pages 不能设置 `Content-Encoding` 响应头，直接上传 Brotli/Gzip 构建会加载失败。
- 文件太大（单个文件超过 100 MB，或整站超过 1 GB）时，改为上传到 itch.io，把 itch 的嵌入地址填进 `playable.src`。

## 关卡设计工作台（作品集演示版）

`public/demos/level-workbench/` 是从 LevelWorkbench 仓库生成的副本，只含 5 张地图：两张 AI 样本、埃及馆、中国馆、镇水·晋祠全图。页面标题和页头换成了作品集版本，并加了"← 作品集"返回链接。源仓库本身不会被改动。

```bash
npm run workbench          # 重新生成副本（默认读取 C:/Users/m2k/Documents/LevelWorkbench 和 JinciLevelTest）
npm run workbench:shots    # 重新截取作品页的封面和画廊图（用 LevelWorkbench 里装好的 Playwright + 本机 Edge）
npm run maps:shots         # 重新生成镇水、AFTER THE 9 作品页的高清动线图、平面图和压力曲线
```

要换地图，改 `scripts/build_workbench.py` 里的 `maps_for()`。GitHub Actions 读不到另外两个仓库，所以生成的副本需要一起提交。

## 大文件下载（GitHub Releases）

可下载的 Windows 版本（镇水、THIIS、reload?!、AFTER THE 9）都比较大，不放进仓库，放在本仓库的 Releases 里，作品页按钮自动指向它。

1. `src/data/site.ts` 里把 `repo` 填成 `用户名/仓库名`。
2. GitHub 仓库页面 → **Releases** → **Draft a new release**。
3. 每个下载包建一个 release，Tag 和文件名要和作品 Markdown 里 `release:` 后面的那段完全一致：

   | 作品 | Tag | 上传时的文件名 |
   |---|---|---|
   | 镇水 | `zhenshui-demo-v1` | `Zhenshui_Greybox_Demo_Win64.zip` |
   | THIIS STORE IS CLOSED | `thiis-demo-v1` | `THIIS_STORE_IS_CLOSED_Win64.zip` |
   | reload?! | `reload-demo-v1` | `reload_Demo2_Win64.zip` |
   | AFTER THE 9 | `after9-demo-v1` | `AFTER_THE_9_main_991a544_Windows_x64.zip`（保留原名） |

4. 先把文件**改成上表里的英文名**再拖进去（中文文件名在 Releases 里会被改乱），点 **Publish release**。

`repo` 没填之前，下载按钮显示为灰色不可点。以后换新版本，新建一个 tag（如 `zhenshui-demo-v2`）并同步改作品 Markdown 里的链接。

## 部署到 GitHub Pages

1. 在 GitHub 新建仓库并推送代码到 `main` 分支。
2. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
3. 之后每次推送 `main` 都会自动构建部署（`.github/workflows/deploy.yml`）。

`site` 和 `base` 由工作流自动传入：仓库名为 `<用户名>.github.io` 时网站在根路径，其他仓库名会部署在 `/<仓库名>/` 下。
代码里所有链接和资源都通过 `src/i18n/ui.ts` 中的 `href()` / `asset()` 生成，两种情况都能正确工作。

## 目录结构

```
src/
  content/works/{zh,en}/   作品 Markdown
  content.config.ts        作品字段定义
  data/site.ts             个人信息
  i18n/ui.ts               界面文案、链接工具函数
  views/                   页面主体（中英共用）
  pages/                   路由（中文在根路径，英文在 /en/）
  components/              画廊、试玩、视频、按钮等
  scripts/motion.ts        所有滚动与进场动效
  styles/global.css        样式与配色变量
public/
  works/<slug>/            作品图片
  demos/<slug>/            可在线游玩的构建
```

## 动效说明

动效集中在 `src/scripts/motion.ts`，用 HTML 属性挂载：

- `data-lines`：大标题逐行上浮
- `data-rv`：滚动到视口时淡入上移
- `data-fade`：页面加载时淡入
- `data-clip`：图片从下往上展开
- `data-parallax`：大图视差
- 首页 `.band`：桌面端固定并横向滚动，手机端改为竖向排列

系统开启"减弱动态效果"时，所有动效自动关闭，内容直接显示。首页卡片与详情页头图之间使用 View Transitions 做共享元素过渡。
