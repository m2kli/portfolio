// Personal info shown across the site.
export const site = {
  // GitHub repo of this site as 'username/repo'. Download links written as
  // `release:<tag>/<file>` in a work's links point to that repo's release assets.
  repo: 'm2kli/portfolio',
  // Stored in two halves and joined in the browser, so the address never appears whole in the HTML.
  email: { user: '1391266381', domain: 'qq.com' },
  links: [
    { label: 'LinkedIn', url: 'https://www.linkedin.com/in/chenhui-li-30997b413/' },
    { label: 'itch.io', url: 'https://chenhui004.itch.io/' },
  ],
  zh: {
    name: '李晨晖',
    title: '李晨晖 — 游戏设计作品集',
    description: '李晨晖的游戏设计作品集：4 个游戏 Demo 与一个基于 AI 的关卡设计工作台。',
    // Each item is one line of the big headline; wrap a word in *…* to italicise it in red.
    headline: ['Designing', '*play*, one', 'room at a time.'],
    aboutHeadline: ['李晨晖'],
  },
  en: {
    name: 'Li Chenhui',
    title: 'Li Chenhui — Game Design Portfolio',
    description: 'Game design portfolio of Li Chenhui: four game demos and an AI-based level design workbench.',
    headline: ['Designing', '*play*, one', 'room at a time.'],
    aboutHeadline: ['Li Chenhui'],
  },
};
