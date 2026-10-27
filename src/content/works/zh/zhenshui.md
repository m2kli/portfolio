---
title: 镇水
summary: "设计 512 m 箱庭关卡的空间结构、动线与节奏；以潜行质量决定终局路线，设计四入口对应不同开战优势的首领战；完成 UE5 纯白模灰盒与指引布光，并建立\"地图数据 → 校验 → 灰盒\"的迭代流程。"
engine: Unreal Engine 5
tags: [第三人称箱庭, 多路径潜行, 关卡灰盒]
cover: works/zhenshui/shot-04.jpg
gallery:
  - src: works/zhenshui/shot-05.jpg
    caption: "圣母殿前庭 · 夜间灰盒与指引布光"
    wide: true
  - src: works/zhenshui/shot-01.jpg
    caption: "可选目标：攀上舍利塔脚手架俯瞰，读出中轴与南北两渠的水路"
  - src: works/zhenshui/shot-02.jpg
    caption: "潜行取得金军银牌：营地火光与巡逻视野"
  - src: works/zhenshui/shot-03.jpg
    caption: "持银牌明过会仙桥哨卡"
  - src: works/zhenshui/shot-04.jpg
    caption: "圣母殿与鱼沼飞梁 · 夜间鸟瞰"

notes:
  - src: works/zhenshui/map-full-3d.png
    caption: "晋祠全图 · 3D 块面（2.5D）：11 个标高层按真实高度叠放"
    wide: true
  - src: works/zhenshui/map-full-flow.png
    caption: "晋祠全图 · 动线：主线与终局三线（北渠 / 中轴 / 南渠）"
  - src: works/zhenshui/map-full-plan.png
    caption: "晋祠全图 · 平面图画法"
  - src: works/zhenshui/map-full-pacing.png
    caption: "晋祠全图 · 主线压力曲线"
    wide: true
  - src: works/zhenshui/map-poi-3d.png
    caption: "圣母殿与鱼沼飞梁 · 3D 块面（2.5D）：渠底、殿内、暗阁、上檐多层关系"
    wide: true
  - src: works/zhenshui/map-poi-flow.png
    caption: "圣母殿与鱼沼飞梁 · 四种入口的动线"
  - src: works/zhenshui/map-poi-plan.png
    caption: "圣母殿与鱼沼飞梁 · 平面图画法"
  - src: works/zhenshui/map-poi-pacing.png
    caption: "圣母殿与鱼沼飞梁 · 主线压力曲线"
    wide: true
links:
  - type: download
    url: release:zhenshui-demo-v1/Zhenshui_Greybox_Demo_Win64.zip
    label: 下载可玩 Demo（Windows · 334 MB）
order: 3
---

### 可玩 Demo

Windows 64 位。解压后双击 `JinciGreybox.exe`，默认全屏，Alt+F4 退出；开场镜头可按空格跳过。

- **WASD / 鼠标**：移动 / 视角
- **空格**：按面前障碍高度自动走上、翻越、攀上或跳抓；黄色长条按住一直爬到顶
- **左 Ctrl**：蹲伏；**左 Shift**：冲刺；**F**：交互 / 拾取
- **鼠标左键**：靠近敌人时攻击
- **V**：显示 / 隐藏敌人视野扇形

> 设计笔记待补充：建议补充灰盒迭代对比。
