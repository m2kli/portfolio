import { getCollection, type CollectionEntry } from 'astro:content';

export const langs = ['zh', 'en'] as const;
export type Lang = (typeof langs)[number];

export const ui = {
  zh: {
    'nav.works': '作品',
    'nav.about': '关于',
    'nav.contact': '联系',
    'hero.issue': '№ 01 / 游戏设计',
    'hero.label': '作品集',
    'works.heading': '精选作品',
    'works.scroll': '← 滚动 →',
    'works.more': '更多作品<br>整理中。',
    'works.read': '阅读案例 →',
    'works.play': '在浏览器中游玩 →',
    'contact.heading': '有个世界<br>想一起<em>建造</em>？',
    'detail.back': '← 全部作品',
    'detail.contribution': '个人设计贡献',
    'detail.year': '年份',
    'detail.role': '职责',
    'detail.team': '团队',
    'detail.duration': '周期',
    'detail.engine': '引擎',
    'detail.platforms': '平台',
    'detail.play': '在线试玩',
    'detail.playStart': '点击开始',
    'detail.playLoading': '加载中…',
    'detail.fullscreen': '全屏',
    'detail.trailer': '预告片',
    'detail.case': '设计笔记',
    'detail.gallery': '画廊',
    'detail.next': '下一个作品',
    'about.heading': '关于',
    'footer.made': '以 Astro 构建，托管于 GitHub Pages',
    'contact.copy': '点击复制',
    'contact.copied': '已复制',
    'lang.switch': 'EN',
  },
  en: {
    'nav.works': 'Works',
    'nav.about': 'About',
    'nav.contact': 'Contact',
    'hero.issue': '№ 01 / Game Design',
    'hero.label': 'Portfolio',
    'works.heading': 'Selected Works',
    'works.scroll': '← Scroll →',
    'works.more': 'More works<br>in the archive.',
    'works.read': 'Read the case →',
    'works.play': 'Play in browser →',
    'contact.heading': 'Have a world<br>to <em>build</em>?',
    'detail.back': '← All works',
    'detail.contribution': 'My contribution',
    'detail.year': 'Year',
    'detail.role': 'Role',
    'detail.team': 'Team',
    'detail.duration': 'Duration',
    'detail.engine': 'Engine',
    'detail.platforms': 'Platforms',
    'detail.play': 'Play in browser',
    'detail.playStart': 'Click to start',
    'detail.playLoading': 'Loading…',
    'detail.fullscreen': 'Fullscreen',
    'detail.trailer': 'Trailer',
    'detail.case': 'Design notes',
    'detail.gallery': 'Gallery',
    'detail.next': 'Next work',
    'about.heading': 'About',
    'footer.made': 'Built with Astro, hosted on GitHub Pages',
    'contact.copy': 'Click to copy',
    'contact.copied': 'Copied',
    'lang.switch': '中文',
  },
} as const;

export type UIKey = keyof (typeof ui)['zh'];

export function useT(lang: Lang) {
  return (key: UIKey) => ui[lang][key];
}

/** Site-relative URL that respects `base` and the locale prefix (zh has none). */
export function href(lang: Lang, path = '') {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const clean = path.replace(/^\/+/, '');
  const prefix = lang === 'en' ? '/en' : '';
  const out = `${base}${prefix}/${clean}`;
  return out.endsWith('/') || out.includes('#') || /\.[a-z0-9]+$/i.test(out) ? out : `${out}/`;
}

/** URL for a file in /public, respecting `base`. Full URLs pass through. */
export function asset(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** The same page in the other language. */
export function altPath(lang: Lang, pathname: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = decodeURI(pathname);
  let rest = path.startsWith(base) ? path.slice(base.length) : path;
  rest = rest.replace(/^\/en(\/|$)/, '/');
  return lang === 'zh' ? `${base}/en${rest}` : `${base}${rest}`;
}

export type Work = CollectionEntry<'works'> & { slug: string };

export async function getWorks(lang: Lang): Promise<Work[]> {
  const all = await getCollection('works', (w) => w.id.startsWith(`${lang}/`));
  return all
    .map((w) => ({ ...w, slug: w.id.slice(lang.length + 1) }))
    .sort((a, b) => a.data.order - b.data.order);
}
