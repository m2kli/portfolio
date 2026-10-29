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
    caption: "晋祠全图 · 3D 块面（2.5D）：13 个标高层按真实高度叠放"
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
    label: 下载可玩 Demo（Windows · 341 MB）
order: 3
---

### 空间与动线

全图 512 × 512 m，14 个区域绕悬瓮山一圈，主线约 1150 m。前半程从渡口、王琼祠一路上山，经栈道、读书台绕到唐叔虞祠；后半程从关帝庙、驻军营、镇口折回水镜台，在中轴前分成三条终局路线：会仙桥中线、北渠、南渠，最后在圣母殿汇合。

### 潜行质量决定终局路线

- 在唐叔虞祠前营潜行取得金军银牌：银牌有效时，可以从会仙桥哨卡明着走中线，但要守伪装规则：拔刀或奔跑都会露馅。
- 一旦被发现，唐叔虞祠鸣锣戒严、银牌作废，关帝庙派出追兵搜索约 40 秒，玩家只能改走南、北两条渠道。
- 难老泉的水声会盖住脚步，是全图唯一敢冲刺的地方；响石（Q）用来引开岗哨，烟丸（G）用来遮断视线，两样都要在场景里捡。

### 次级兴趣点的玩法

- **驻军营**：用栅栏分成前营和后营，有两座箭楼、中军帐、军械库、粮草场和马厩，共 13 名敌人。火烧粮草会让全营去救火，还会从中线调走两名巡逻，给终局中线减压。
- **镇口**：城门楼哨兵、两处囚笼，囚笼里一处给响石，另一处讲旧事。
- **唐叔虞祠 / 关帝庙**：鸣锣与追兵是对玩家失误的惩罚链，戒严时亮起撤离灯，给玩家指出退路。

### 首领战：四种入殿方式

圣母殿与鱼沼飞梁是核心兴趣点（128 m 范围，暗阁为第二层）。四个入口分别对应不同的开战优势：

- **E1 正面 · 飞梁**：没有优势，一对三正面迎战。
- **E2 水下 · 柱林**：从南渠经暗渠进入，可以背刺一名亲卫，变成一对二。
- **E3 暗阁 · 北气窗**：先卸下总闸栓，二阶段时间更充裕。
- **E4 屋顶 · 崖降**：从栈道崖壁攀上、跳落上檐，开场一击就让首领损失约四分之一体力。

首领韩守渠分两阶段，二阶段限时，要赶在他拉开总闸前把闸落下。

### 迭代方式

关卡先写成地图数据，在自制的关卡工作台里看平面、动线、3D 块面和压力曲线，校验通过后再生成 UE5 灰盒；关卡里的手改也写回地图数据，保证图纸和灰盒始终一致。灰盒阶段已经完成圣母殿、鱼沼飞梁 · 献殿的建筑精修。
