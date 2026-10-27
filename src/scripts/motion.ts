import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);
if (import.meta.env.DEV) Object.assign(window, { gsap, ScrollTrigger });

// Markup hooks:
//   [data-lines]  headline whose `.ln > span` children rise in line by line
//   [data-fade]   fades in on page load
//   [data-rv]     fades up when scrolled into view
//   [data-clip]   image block that wipes open from the bottom when scrolled into view
//   .band         home works band: pinned + scrolls horizontally on desktop

let ctx: gsap.Context | null = null;

function init() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  ctx = gsap.context(() => {
    gsap.to('[data-lines] .ln > span', { yPercent: 0, y: 0, duration: 1.3, ease: 'expo.out', stagger: 0.12, delay: 0.1 });
    gsap.to('[data-fade]', { opacity: 1, duration: 1, delay: 0.5, stagger: 0.1 });

    gsap.utils.toArray<HTMLElement>('[data-rv]').forEach((el) => {
      gsap.fromTo(el, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 88%' } });
    });

    gsap.utils.toArray<HTMLElement>('[data-clip]').forEach((el) => {
      const img = el.querySelector('img, svg');
      const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: 'top 85%' } });
      tl.to(el, { clipPath: 'inset(0% 0 0 0)', duration: 1.4, ease: 'expo.inOut' });
      if (img) tl.from(img, { scale: 1.2, duration: 1.8, ease: 'expo.out' }, 0);
    });

    // gentle parallax on large covers (no hidden start state, so view-transition morphs land on a visible image)
    gsap.utils.toArray<HTMLElement>('[data-parallax]').forEach((el) => {
      const img = el.querySelector('img');
      if (img) gsap.to(img, { yPercent: -12, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
    });

    const band = document.querySelector<HTMLElement>('.band');
    if (band) initBand(band);
  });

  // fonts can shift layout after first paint
  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

function initBand(band: HTMLElement) {
  const track = band.querySelector<HTMLElement>('.track')!;
  const pieces = gsap.utils.toArray<HTMLElement>('.piece', band);
  const progress = band.querySelector<HTMLElement>('.band-progress i');
  const mm = gsap.matchMedia();

  mm.add('(min-width: 761px)', () => {
    const dist = () => track.scrollWidth - innerWidth;
    const tween = gsap.to(track, {
      x: () => -dist(),
      ease: 'none',
      scrollTrigger: {
        trigger: band,
        pin: true,
        scrub: 1,
        end: () => '+=' + dist(),
        invalidateOnRefresh: true,
        onUpdate: (s) => progress && gsap.set(progress, { scaleX: s.progress }),
      },
    });
    pieces.forEach((p) => {
      const img = p.querySelector<HTMLElement>('.img')!;
      gsap.to(img, { clipPath: 'inset(0% 0 0 0)', duration: 1.4, ease: 'expo.inOut', scrollTrigger: { trigger: p, containerAnimation: tween, start: 'left 85%' } });
      gsap.fromTo(img.querySelector('img'), { scale: 1.25 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: p, containerAnimation: tween, start: 'left right', end: 'right left', scrub: true } });
    });
  });

  mm.add('(max-width: 760px)', () => {
    pieces.forEach((p) => {
      const img = p.querySelector<HTMLElement>('.img')!;
      const tl = gsap.timeline({ scrollTrigger: { trigger: img, start: 'top 85%' } });
      tl.to(img, { clipPath: 'inset(0% 0 0 0)', duration: 1.4, ease: 'expo.inOut' }).fromTo(img.querySelector('img'), { scale: 1.25 }, { scale: 1, duration: 1.8, ease: 'expo.out' }, 0);
    });
  });
}

document.addEventListener('astro:page-load', init);
document.addEventListener('astro:before-swap', () => {
  ctx?.revert();
  ctx = null;
  ScrollTrigger.getAll().forEach((t) => t.kill());
});
